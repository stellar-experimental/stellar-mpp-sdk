import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { type Challenge, type Credential, Method, Receipt, Store } from 'mppx'
import type { z } from 'zod/mini'
import {
  ALL_ZEROS,
  DEFAULT_DECIMALS,
  DEFAULT_LEDGER_CLOSE_TIME,
  DEFAULT_TIMEOUT,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  STELLAR_TESTNET,
  type NetworkId,
} from '../../constants.js'
import * as Methods from '../Methods.js'
import { toBaseUnits } from '../Methods.js'
import { scValToBigInt } from '../../shared/scval.js'
import { resolveKeypair } from '../../shared/keypairs.js'
import { pollTransaction } from '../../shared/poll.js'
import { wrapFeeBump } from '../../shared/fee-bump.js'
import { PaymentVerificationError, SettlementError } from '../../shared/errors.js'
import { noopLogger, type Logger } from '../../shared/logger.js'
import { SimulationContractError, simulateCall } from '../../shared/simulate.js'
import {
  DEFAULT_MAX_FEE_BUMP_STROOPS,
  DEFAULT_POLL_MAX_ATTEMPTS,
  DEFAULT_POLL_DELAY_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_SIMULATION_TIMEOUT_MS,
} from '../../shared/defaults.js'

type ChargePayload = z.output<(typeof Methods.charge)['schema']['credential']['payload']>
type ChargeRequest = z.output<(typeof Methods.charge)['schema']['request']>
type ChargeCredential = Credential.Credential<
  ChargePayload,
  Challenge.Challenge<ChargeRequest, 'charge', 'stellar'>
>

const LOG_PREFIX = '[stellar:charge]'
const STORE_PREFIX = 'stellar:charge'

/**
 * Creates a Stellar charge method for use on the **server**.
 *
 * Verifies and settles Soroban SAC `transfer` invocations received as
 * pull-mode (signed XDR) or push-mode (on-chain tx hash) credentials.
 *
 * @see https://paymentauth.org/draft-stellar-charge-00
 */
export function charge(parameters: charge.Parameters) {
  const {
    currency,
    decimals = DEFAULT_DECIMALS,
    feePayer,
    logger = noopLogger,
    maxFeeBumpStroops = DEFAULT_MAX_FEE_BUMP_STROOPS,
    network = STELLAR_TESTNET,
    pollDelayMs = DEFAULT_POLL_DELAY_MS,
    pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    recipient,
    rpcUrl,
    simulationTimeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS,
    store,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const signerKeypair = feePayer ? resolveKeypair(feePayer.envelopeSigner) : undefined
  const feeBumpKeypair = feePayer?.feeBumpSigner
    ? resolveKeypair(feePayer.feeBumpSigner)
    : undefined

  // Serialize verify operations to prevent concurrent race conditions
  // on tx hash deduplication (get/put is not atomic).
  let verifyLock: Promise<unknown> = Promise.resolve()

  return Method.toServer(Methods.charge, {
    defaults: {
      currency,
      recipient,
    },
    request({ request }) {
      return {
        ...request,
        amount: toBaseUnits(request.amount, decimals),
        methodDetails: {
          network,
          ...(signerKeypair ? { feePayer: true } : {}),
        },
      }
    },
    async verify({ credential }) {
      // Serialize through the lock to prevent concurrent race conditions
      const result = await new Promise<Receipt.Receipt>((resolve, reject) => {
        verifyLock = verifyLock.then(
          () => doVerify(credential).then(resolve, reject),
          () => doVerify(credential).then(resolve, reject),
        )
      })
      return result
    },
  })

  async function doVerify(credential: ChargeCredential) {
    const { challenge } = credential
    const { request: challengeRequest } = challenge

    // Check challenge replay early, but only mark as used AFTER successful
    // verification to avoid permanently burning a challenge on transient failures.
    const challengeStoreKey = store ? `${STORE_PREFIX}:challenge:${challenge.id}` : undefined
    if (store && challengeStoreKey) {
      const existing = await store.get(challengeStoreKey)
      if (existing) {
        throw new PaymentVerificationError(`${LOG_PREFIX} Challenge already used. Replay rejected.`)
      }
    }

    const { amount, externalId } = challengeRequest
    const expectedCurrency = challengeRequest.currency
    const expectedRecipient = challengeRequest.recipient
    const expectedAmount = BigInt(amount)

    const payload = credential.payload

    switch (payload.type) {
      case 'hash': {
        // Spec: push mode MUST NOT be used with feePayer=true
        if (challengeRequest.methodDetails?.feePayer) {
          throw new PaymentVerificationError(
            `${LOG_PREFIX} Push mode (type="hash") is not allowed with feePayer=true.`,
          )
        }

        const hash = payload.hash

        // Check tx hash dedup BEFORE verification to reject known replays
        // early, but only mark as used AFTER successful verification to
        // avoid permanently burning a hash on transient failures.
        if (store) {
          const hashKey = `${STORE_PREFIX}:hash:${hash}`
          const hashUsed = await store.get(hashKey)
          if (hashUsed) {
            logger.warn(`${LOG_PREFIX} Verification failed`, {
              error: 'Transaction hash already used',
              hash,
            })
            throw new PaymentVerificationError(
              `${LOG_PREFIX} Transaction hash already used. Replay rejected.`,
              {
                hash,
              },
            )
          }
        }

        const txResult = await pollTransaction(server, hash, {
          maxAttempts: pollMaxAttempts,
          delayMs: pollDelayMs,
          timeoutMs: pollTimeoutMs,
        })

        // Extract the payer's public key from the credential DID to verify
        // the on-chain transfer's `from` address matches the credential's
        // claimed identity, preventing hash-theft attacks against clients.
        const expectedFrom = publicKeyFromDID(credential.source)
        verifySacTransfer(
          txResult,
          {
            amount: expectedAmount,
            currency: expectedCurrency,
            recipient: expectedRecipient,
            from: expectedFrom,
          },
          networkPassphrase,
        )

        // Mark challenge + hash as used only after successful verification
        if (store) {
          await store.put(`${STORE_PREFIX}:hash:${hash}`, { usedAt: new Date().toISOString() })
          await store.put(challengeStoreKey!, { usedAt: new Date().toISOString() })
        }

        return Receipt.from({
          method: 'stellar',
          reference: hash,
          status: 'success',
          timestamp: new Date().toISOString(),
          ...(externalId ? { externalId } : {}),
        })
      }

      case 'transaction': {
        const txXdr = payload.transaction
        const parsed = TransactionBuilder.fromXDR(txXdr, networkPassphrase)

        const tx =
          parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : (parsed as Transaction)

        verifyExactlyOneInvokeOp(tx)
        verifyNoSigningAddressInSources(tx, signerKeypair, feeBumpKeypair)

        const expectedFrom = publicKeyFromDID(credential.source)
        verifySacInvocation(tx, {
          amount: expectedAmount,
          currency: expectedCurrency,
          recipient: expectedRecipient,
          from: expectedFrom,
        })

        let txToSubmit: Transaction | FeeBumpTransaction = parsed as
          | Transaction
          | FeeBumpTransaction

        if (!signerKeypair && tx.source === ALL_ZEROS) {
          logger.warn(`${LOG_PREFIX} Verification failed`, {
            error: 'Sponsored source without feePayer',
          })
          throw new PaymentVerificationError(
            `${LOG_PREFIX} Transaction uses a sponsored source account but the server has no feePayer configuration.`,
            {},
          )
        }

        // Determine expires from challenge for ledger expiration calculations
        const expiresTimestamp: number | undefined = challenge.expires
          ? Math.floor(new Date(challenge.expires).getTime() / 1000)
          : undefined

        if (signerKeypair && tx.source === ALL_ZEROS) {
          // ── Sponsored path ──────────────────────────────────────────

          await validateAuthEntries(tx, signerKeypair.publicKey(), expiresTimestamp)

          // Rebuild the tx with the signer's account as source
          logger.debug(`${LOG_PREFIX} Rebuilding sponsored tx...`)
          const serverAccount = await server.getAccount(signerKeypair.publicKey())
          const envelopeTx = tx.toEnvelope().v1().tx()
          const sorobanData = envelopeTx.ext().sorobanData()
          const rebuilt = new TransactionBuilder(serverAccount, {
            fee: Math.min(Number(tx.fee), maxFeeBumpStroops).toString(),
            networkPassphrase,
            ...(tx.timeBounds ? { timebounds: tx.timeBounds } : {}),
          })
          // Only copy the single validated raw XDR operation
          rebuilt.addOperation(envelopeTx.operations()[0])
          if (!tx.timeBounds) {
            rebuilt.setTimeout(DEFAULT_TIMEOUT)
          }
          const rebuiltTx = rebuilt.setSorobanData(sorobanData).build()

          await simulateAndValidateTransfer(
            rebuiltTx,
            expectedAmount,
            expectedCurrency,
            expectedRecipient,
            signerKeypair.publicKey(),
            expectedFrom,
          )

          rebuiltTx.sign(signerKeypair)
          txToSubmit = rebuiltTx

          // Fee bump wrapping (sponsored path only — spec requires
          // unsponsored transactions to be submitted without modification)
          if (feeBumpKeypair) {
            logger.debug(`${LOG_PREFIX} Fee bump wrapping`)
            txToSubmit = wrapFeeBump(txToSubmit, feeBumpKeypair, {
              networkPassphrase,
              maxFeeStroops: maxFeeBumpStroops,
            })
          }
        } else {
          // ── Unsponsored path ────────────────────────────────────────

          if (expiresTimestamp && tx.timeBounds) {
            const maxTime = parseInt(tx.timeBounds.maxTime, 10)
            if (maxTime > expiresTimestamp) {
              throw new PaymentVerificationError(
                `${LOG_PREFIX} Transaction timeBounds.maxTime exceeds challenge expires.`,
                {
                  maxTime,
                  expires: expiresTimestamp,
                },
              )
            }
          }

          await simulateAndValidateTransfer(
            tx,
            expectedAmount,
            expectedCurrency,
            expectedRecipient,
            signerKeypair?.publicKey(),
            expectedFrom,
          )
        }

        // ── Settlement ──────────────────────────────────────────────
        let sendResult: rpc.Api.SendTransactionResponse
        try {
          logger.debug(`${LOG_PREFIX} Broadcasting tx`)
          sendResult = await server.sendTransaction(txToSubmit)
          logger.debug(`${LOG_PREFIX} Broadcast result`, {
            hash: sendResult.hash,
            status: sendResult.status,
          })
        } catch (error) {
          throw new SettlementError(
            `${LOG_PREFIX} Settlement failed: could not broadcast transaction.`,
            {
              details: error instanceof Error ? error.message : String(error),
            },
          )
        }

        if (sendResult.status === 'ERROR' || sendResult.status === 'DUPLICATE') {
          throw new SettlementError(
            `${LOG_PREFIX} Settlement failed: sendTransaction returned ${sendResult.status}.`,
            { hash: sendResult.hash, status: sendResult.status },
          )
        }

        try {
          await pollTransaction(server, sendResult.hash, {
            maxAttempts: pollMaxAttempts,
            delayMs: pollDelayMs,
            timeoutMs: pollTimeoutMs,
          })
        } catch (error) {
          throw new SettlementError(`${LOG_PREFIX} Settlement failed: transaction not confirmed.`, {
            hash: sendResult.hash,
            details: error instanceof Error ? error.message : String(error),
          })
        }

        // Mark challenge as used only after successful settlement
        if (store && challengeStoreKey) {
          await store.put(challengeStoreKey, { usedAt: new Date().toISOString() })
        }

        return Receipt.from({
          method: 'stellar',
          reference: sendResult.hash,
          status: 'success',
          timestamp: new Date().toISOString(),
          ...(externalId ? { externalId } : {}),
        })
      }

      default:
        throw new PaymentVerificationError(
          `Unsupported credential type "${(payload as { type: string }).type}".`,
        )
    }
  }

  // ── Simulation validation ─────────────────────────────────────────────

  async function simulateAndValidateTransfer(
    tx: Transaction,
    expectedAmount: bigint,
    expectedCurrency: string,
    expectedRecipient: string,
    serverAddress: string | undefined,
    expectedFrom: string,
  ) {
    let simResponse: rpc.Api.SimulateTransactionSuccessResponse
    try {
      simResponse = await simulateCall(server, tx, { timeoutMs: simulationTimeoutMs })
    } catch (error) {
      if (error instanceof SimulationContractError) {
        throw new PaymentVerificationError(
          `${LOG_PREFIX} Pre-submission simulation failed: ${error.simulationError}`,
          { simulationError: error.simulationError },
        )
      }
      // Timeout and network errors bubble up as-is
      throw error
    }

    if (!simResponse.events || simResponse.events.length === 0) {
      throw new PaymentVerificationError(
        `${LOG_PREFIX} Simulation produced no transfer events — cannot verify transfer.`,
        {},
      )
    }

    validateSimulationEvents(
      simResponse.events,
      expectedAmount,
      expectedCurrency,
      expectedRecipient,
      serverAddress,
      expectedFrom,
    )
  }

  // ── Auth entry validation (sponsored path) ────────────────────────────

  async function validateAuthEntries(
    tx: Transaction,
    serverPublicKey: string,
    expiresTimestamp: number | undefined,
  ) {
    const envelope = tx.toEnvelope().v1().tx()
    const ops = envelope.operations()

    // Calculate max ledger from expires
    let maxLedger: number | undefined
    if (expiresTimestamp) {
      const nowSecs = Math.floor(Date.now() / 1000)
      const secsUntilExpiry = expiresTimestamp - nowSecs
      if (secsUntilExpiry > 0) {
        const latestLedger = await server.getLatestLedger()
        maxLedger = latestLedger.sequence + Math.ceil(secsUntilExpiry / DEFAULT_LEDGER_CLOSE_TIME)
      }
    }

    const serverAddress = Address.fromString(serverPublicKey)

    for (let i = 0; i < ops.length; i++) {
      const opBody = ops[i].body()
      if (opBody.switch().value !== xdr.OperationType.invokeHostFunction().value) {
        throw new PaymentVerificationError(
          `${LOG_PREFIX} All operations must be invokeHostFunction in sponsored path.`,
          { operationType: opBody.switch().name },
        )
      }

      const authEntries = opBody.invokeHostFunctionOp().auth()
      for (const entry of authEntries) {
        const credentials = entry.credentials()

        // Reject non-address credential types — only sorobanCredentialsAddress is
        // permitted. Source-account credentials would be implicitly authorized by the
        // server's envelope signature, allowing the client to piggyback operations.
        if (
          credentials.switch().value !==
          xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
        ) {
          throw new PaymentVerificationError(
            `${LOG_PREFIX} Only address-type auth entries are permitted.`,
            { credentialType: credentials.switch().name },
          )
        }

        const addressCred = credentials.address()

        const entryAddress = Address.fromScAddress(addressCred.address())
        if (entryAddress.toString() === serverAddress.toString()) {
          throw new PaymentVerificationError(
            `${LOG_PREFIX} Server address must not appear in client auth entries.`,
            { serverAddress: serverPublicKey },
          )
        }

        if (maxLedger !== undefined) {
          const entryExpiration = addressCred.signatureExpirationLedger()
          if (entryExpiration > maxLedger) {
            throw new PaymentVerificationError(
              `${LOG_PREFIX} Auth entry expiration exceeds maximum allowed ledger.`,
              {
                entryExpiration,
                maxLedger,
              },
            )
          }
        }

        const rootInvocation = entry.rootInvocation()
        if (rootInvocation.subInvocations().length > 0) {
          throw new PaymentVerificationError(
            `${LOG_PREFIX} Auth entries must not contain sub-invocations.`,
            {},
          )
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

function verifyExactlyOneInvokeOp(tx: Transaction) {
  if (tx.operations.length !== 1) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transaction must contain exactly one operation, got ${tx.operations.length}.`,
      { operationCount: tx.operations.length },
    )
  }

  const op = tx.operations[0]
  if (op.type !== 'invokeHostFunction') {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transaction does not contain a Soroban invocation.`,
      { operationType: op.type },
    )
  }
}

function verifyNoSigningAddressInSources(
  tx: Transaction,
  signerKeypair: Keypair | undefined,
  feeBumpKeypair: Keypair | undefined,
) {
  if (!signerKeypair) return

  const signingAddresses = new Set<string>()
  signingAddresses.add(signerKeypair.publicKey())
  if (feeBumpKeypair) signingAddresses.add(feeBumpKeypair.publicKey())

  if (signingAddresses.has(tx.source)) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transaction source must not be a server signing address.`,
      {},
    )
  }

  for (const op of tx.operations) {
    if (op.source && signingAddresses.has(op.source)) {
      throw new PaymentVerificationError(
        `${LOG_PREFIX} Operation source must not be a server signing address.`,
        {},
      )
    }
  }
}

function verifySacInvocation(
  tx: Transaction,
  expected: { amount: bigint; currency: string; recipient: string; from: string },
) {
  const xdrEnvelope = tx.toXDR()
  const envelope = xdr.TransactionEnvelope.fromXDR(xdrEnvelope, 'base64')
  const txBody = envelope.v1().tx()
  const ops = txBody.operations()

  if (ops.length !== 1) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Expected exactly 1 operation in envelope, got ${ops.length}.`,
      { count: ops.length },
    )
  }

  const opBody = ops[0].body()
  if (opBody.switch().value !== xdr.OperationType.invokeHostFunction().value) {
    throw new PaymentVerificationError(`${LOG_PREFIX} Operation is not invokeHostFunction.`, {
      operationType: opBody.switch().name,
    })
  }

  const hostFn = opBody.invokeHostFunctionOp().hostFunction()
  if (hostFn.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Host function is not a contract invocation.`,
      { hostFunctionType: hostFn.switch().name },
    )
  }

  const invokeArgs = hostFn.invokeContract()
  const contractAddress = Address.fromScAddress(invokeArgs.contractAddress()).toString()
  const functionName = invokeArgs.functionName().toString()
  const args = invokeArgs.args()

  if (contractAddress !== expected.currency) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Contract address does not match expected currency.`,
      { expected: expected.currency, actual: contractAddress },
    )
  }

  if (functionName !== 'transfer') {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Function name must be "transfer", got "${functionName}".`,
      { functionName },
    )
  }

  if (args.length !== 3) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transfer function expects 3 arguments, got ${args.length}.`,
      { argCount: args.length },
    )
  }

  const fromAddress = Address.fromScVal(args[0]).toString()
  if (fromAddress !== expected.from) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transfer "from" does not match credential source.`,
      { expected: expected.from, actual: fromAddress },
    )
  }

  const toAddress = Address.fromScVal(args[1]).toString()
  if (toAddress !== expected.recipient) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transfer "to" does not match expected recipient.`,
      { expected: expected.recipient, actual: toAddress },
    )
  }

  const amountVal = scValToBigInt(args[2])
  if (amountVal !== expected.amount) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transfer amount does not match expected amount.`,
      { expected: expected.amount.toString(), actual: amountVal.toString() },
    )
  }
}

function verifySacTransfer(
  txResult: rpc.Api.GetSuccessfulTransactionResponse,
  expected: { amount: bigint; currency: string; recipient: string; from: string },
  networkPassphrase: string,
) {
  if (!txResult.envelopeXdr) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Transaction result is missing envelope XDR — cannot verify payment.`,
      {},
    )
  }

  let envelope: xdr.TransactionEnvelope
  if (typeof txResult.envelopeXdr === 'string') {
    try {
      envelope = xdr.TransactionEnvelope.fromXDR(txResult.envelopeXdr, 'base64')
    } catch (error) {
      throw new PaymentVerificationError(
        `${LOG_PREFIX} Could not parse transaction envelope for verification.`,
        {
          details: error instanceof Error ? error.message : String(error),
        },
      )
    }
  } else {
    envelope = txResult.envelopeXdr
  }

  let innerTx: Transaction
  try {
    innerTx = new Transaction(envelope, networkPassphrase)
  } catch {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Could not parse transaction envelope for verification.`,
      {},
    )
  }

  verifyExactlyOneInvokeOp(innerTx)
  verifySacInvocation(innerTx, expected)
}

// ---------------------------------------------------------------------------
// Simulation event validation (CAP-46 transfer events)
// ---------------------------------------------------------------------------

function validateSimulationEvents(
  events: xdr.DiagnosticEvent[],
  expectedAmount: bigint,
  expectedCurrency: string,
  expectedRecipient: string,
  serverAddress: string | undefined,
  expectedFrom: string,
) {
  const transferEvents: Array<{ from: string; to: string; amount: bigint; contract: string }> = []

  for (const event of events) {
    const contractEvent = event.event()
    // Only process contract events (type 0)
    if (contractEvent.type().value !== 0) continue

    const body = contractEvent.body().v0()
    const topics = body.topics()
    if (topics.length < 3) continue

    // CAP-46: topic[0] = "transfer"
    const topicName = topics[0].sym?.()?.toString()
    if (topicName !== 'transfer') continue

    const from = Address.fromScVal(topics[1]).toString()
    const to = Address.fromScVal(topics[2]).toString()
    const amount = scValToBigInt(body.data())
    const contract = contractEvent.contractId()
      ? Address.fromScAddress(
          xdr.ScAddress.scAddressTypeContract(contractEvent.contractId()!),
        ).toString()
      : ''

    transferEvents.push({ from, to, amount, contract })
  }

  if (transferEvents.length === 0) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Simulation produced no transfer events — cannot verify transfer.`,
      {},
    )
  }

  // Spec: "events MUST show only expected balance changes; any other balance
  // change fails verification." Reject if there are unexpected transfers.
  if (transferEvents.length !== 1) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Simulation produced ${transferEvents.length} transfer events; expected exactly 1.`,
      { count: transferEvents.length },
    )
  }

  const transfer = transferEvents[0]
  if (
    transfer.to !== expectedRecipient ||
    transfer.amount !== expectedAmount ||
    transfer.contract !== expectedCurrency ||
    transfer.from !== expectedFrom
  ) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Simulation transfer event does not match expected parameters.`,
      {
        expectedRecipient,
        expectedAmount: expectedAmount.toString(),
        expectedCurrency,
        expectedFrom,
      },
    )
  }

  // Server address must not be involved in transfers
  if (serverAddress) {
    const serverInvolved = transferEvents.some(
      (t) => t.from === serverAddress || t.to === serverAddress,
    )
    if (serverInvolved) {
      throw new PaymentVerificationError(
        `${LOG_PREFIX} Server address must not be involved in transfer events.`,
        { serverAddress },
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the Stellar public key from a `did:pkh` DID string.
 *
 * Format: `did:pkh:stellar:{network}:{G...publicKey}`
 *
 * Throws `PaymentVerificationError` if the source is absent, not a string,
 * or does not conform to the expected `did:pkh` format. A credential without
 * a verifiable source must be rejected — silently skipping the sender check
 * would leave the hash-theft attack vector open.
 */
function publicKeyFromDID(source: unknown): string {
  if (typeof source !== 'string' || !source) {
    throw new PaymentVerificationError(
      `${LOG_PREFIX} Credential source is required to verify the sender address.`,
      {},
    )
  }
  const parts = source.split(':')
  // did : pkh : stellar : {network} : {pubkey}
  if (
    parts.length === 5 &&
    parts[0] === 'did' &&
    parts[1] === 'pkh' &&
    parts[2] === 'stellar' &&
    parts[3] // non-empty network
  ) {
    const pubKey = parts[4]
    try {
      Keypair.fromPublicKey(pubKey)
    } catch {
      throw new PaymentVerificationError(
        `${LOG_PREFIX} Credential source contains an invalid Stellar public key.`,
        { source },
      )
    }
    return pubKey
  }
  throw new PaymentVerificationError(
    `${LOG_PREFIX} Credential source has invalid format — expected did:pkh:stellar:{network}:{pubkey}.`,
    { source },
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export declare namespace charge {
  type Parameters = {
    recipient: string
    currency: string
    decimals?: number
    network?: NetworkId
    rpcUrl?: string
    /**
     * Server-sponsored fee configuration.
     *
     * When set, the challenge includes `methodDetails.feePayer: true` which
     * tells the client to use pull mode with an all-zeros placeholder source.
     * The server rebuilds the transaction with its own account and signs the
     * envelope.
     */
    feePayer?: {
      /** Keypair providing the source account and envelope signature. */
      envelopeSigner: Keypair | string
      /** Optional fee bump signer — wraps the sponsored tx in a FeeBumpTransaction. */
      feeBumpSigner?: Keypair | string
    }
    store?: Store.Store
    maxFeeBumpStroops?: number
    pollMaxAttempts?: number
    pollDelayMs?: number
    pollTimeoutMs?: number
    simulationTimeoutMs?: number
    logger?: Logger
  }
}
