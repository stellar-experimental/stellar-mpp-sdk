import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { Method, Receipt, Store } from 'mppx'
import {
  ALL_ZEROS,
  CAIP2_NETWORK,
  DEFAULT_DECIMALS,
  DEFAULT_LEDGER_CLOSE_TIME,
  DEFAULT_TIMEOUT,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
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

export function charge(parameters: charge.Parameters) {
  const {
    currency,
    decimals = DEFAULT_DECIMALS,
    feeBumpSigner: feeBumpSignerParam,
    logger = noopLogger,
    maxFeeBumpStroops = DEFAULT_MAX_FEE_BUMP_STROOPS,
    network = 'testnet',
    pollDelayMs = DEFAULT_POLL_DELAY_MS,
    pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    recipient,
    rpcUrl,
    simulationTimeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS,
    signer: signerParam,
    store,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const signerKeypair = signerParam ? resolveKeypair(signerParam) : undefined

  const feeBumpKeypair = feeBumpSignerParam ? resolveKeypair(feeBumpSignerParam) : undefined

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
          network: CAIP2_NETWORK[network],
          ...(signerKeypair ? { feePayer: true } : {}),
        },
      }
    },
    async verify({ credential }) {
      // Serialize through the lock to prevent concurrent race conditions
      const result = await new Promise<any>((resolve, reject) => {
        verifyLock = verifyLock.then(
          () => doVerify(credential).then(resolve, reject),
          () => doVerify(credential).then(resolve, reject),
        )
      })
      return result
    },
  })

  async function doVerify(credential: any) {
    const { challenge } = credential
    const { request: challengeRequest } = challenge

    if (store) {
      const key = `stellar:charge:challenge:${challenge.id}`
      const existing = await store.get(key)
      if (existing) {
        throw new PaymentVerificationError(
          '[stellar:charge] Challenge already used. Replay rejected.',
        )
      }
      await store.put(key, { usedAt: new Date().toISOString() })
    }

    const { amount } = challengeRequest
    const expectedCurrency = challengeRequest.currency
    const expectedRecipient = challengeRequest.recipient
    const expectedAmount = BigInt(amount)

    const payload = credential.payload

    switch (payload.type) {
      case 'hash': {
        const hash = payload.hash

        // Check tx hash dedup BEFORE verification to reject known replays
        // early, but only mark as used AFTER successful verification to
        // avoid permanently burning a hash on transient failures.
        if (store) {
          const hashKey = `stellar:charge:hash:${hash}`
          const hashUsed = await store.get(hashKey)
          if (hashUsed) {
            logger.warn('[stellar:charge] Verification failed', {
              error: 'Transaction hash already used',
              hash,
            })
            throw new PaymentVerificationError(
              '[stellar:charge] Transaction hash already used. Replay rejected.',
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

        verifySacTransfer(
          txResult,
          {
            amount: expectedAmount,
            currency: expectedCurrency,
            recipient: expectedRecipient,
          },
          networkPassphrase,
        )

        // Mark tx hash as used only after successful verification
        if (store) {
          await store.put(`stellar:charge:hash:${hash}`, { usedAt: new Date().toISOString() })
        }

        return Receipt.from({
          method: 'stellar',
          reference: hash,
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      }

      case 'transaction': {
        const txXdr = payload.transaction
        const parsed = TransactionBuilder.fromXDR(txXdr, networkPassphrase)

        const tx =
          parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : (parsed as Transaction)

        verifyExactlyOneInvokeOp(tx)

        verifySacInvocation(tx, {
          amount: expectedAmount,
          currency: expectedCurrency,
          recipient: expectedRecipient,
        })

        let txToSubmit: Transaction | FeeBumpTransaction = parsed as
          | Transaction
          | FeeBumpTransaction

        if (!signerKeypair && tx.source === ALL_ZEROS) {
          logger.warn('[stellar:charge] Verification failed', {
            error: 'Sponsored source without signer',
          })
          throw new PaymentVerificationError(
            '[stellar:charge] Transaction uses a sponsored source account but the server is not configured with a signer.',
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
          logger.debug('[stellar:charge] Rebuilding sponsored tx...')
          const serverAccount = await server.getAccount(signerKeypair.publicKey())
          const envelopeTx = tx.toEnvelope().v1().tx()
          const sorobanData = envelopeTx.ext().sorobanData()
          const rebuilt = new TransactionBuilder(serverAccount, {
            fee: tx.fee,
            networkPassphrase,
            memo: tx.memo,
            ...(tx.timeBounds ? { timebounds: tx.timeBounds } : {}),
          })
          for (const rawOp of envelopeTx.operations()) {
            rebuilt.addOperation(rawOp)
          }
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
          )

          rebuiltTx.sign(signerKeypair)
          txToSubmit = rebuiltTx
        } else {
          // ── Unsponsored path ────────────────────────────────────────

          if (expiresTimestamp && tx.timeBounds) {
            const maxTime = parseInt(tx.timeBounds.maxTime, 10)
            if (maxTime > expiresTimestamp) {
              throw new PaymentVerificationError(
                '[stellar:charge] Transaction timeBounds.maxTime exceeds challenge expires.',
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
          )
        }

        // ── Fee bump wrapping ───────────────────────────────────────
        if (feeBumpKeypair) {
          logger.debug('[stellar:charge] Fee bump wrapping')
          txToSubmit = wrapFeeBump(txToSubmit, feeBumpKeypair, {
            networkPassphrase,
            maxFeeStroops: maxFeeBumpStroops,
          })
        }

        // ── Settlement ──────────────────────────────────────────────
        let sendResult: rpc.Api.SendTransactionResponse
        try {
          logger.debug('[stellar:charge] Broadcasting tx')
          sendResult = await server.sendTransaction(txToSubmit)
          logger.debug('[stellar:charge] Broadcasting tx', { hash: sendResult.hash })
        } catch (error) {
          throw new SettlementError(
            '[stellar:charge] Settlement failed: could not broadcast transaction.',
            {
              details: error instanceof Error ? error.message : String(error),
            },
          )
        }

        try {
          await pollTransaction(server, sendResult.hash, {
            maxAttempts: pollMaxAttempts,
            delayMs: pollDelayMs,
            timeoutMs: pollTimeoutMs,
          })
        } catch (error) {
          throw new SettlementError(
            '[stellar:charge] Settlement failed: transaction not confirmed.',
            {
              hash: sendResult.hash,
              details: error instanceof Error ? error.message : String(error),
            },
          )
        }

        return Receipt.from({
          method: 'stellar',
          reference: sendResult.hash,
          status: 'success',
          timestamp: new Date().toISOString(),
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
  ) {
    let simResponse: rpc.Api.SimulateTransactionSuccessResponse
    try {
      simResponse = await simulateCall(server, tx, { timeoutMs: simulationTimeoutMs })
    } catch (error) {
      if (error instanceof SimulationContractError) {
        throw new PaymentVerificationError(
          `[stellar:charge] Pre-submission simulation failed: ${error.simulationError}`,
          { simulationError: error.simulationError },
        )
      }
      // Timeout and network errors bubble up as-is
      throw error
    }

    // Validate simulation events for expected transfer
    if (simResponse.events && simResponse.events.length > 0) {
      validateSimulationEvents(
        simResponse.events,
        expectedAmount,
        expectedCurrency,
        expectedRecipient,
        serverAddress,
      )
    }
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
        continue
      }

      const authEntries = opBody.invokeHostFunctionOp().auth()
      for (const entry of authEntries) {
        const credentials = entry.credentials()

        // Only validate address-type credentials
        if (
          credentials.switch().value !==
          xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
        ) {
          continue
        }

        const addressCred = credentials.address()

        const entryAddress = Address.fromScAddress(addressCred.address())
        if (entryAddress.toString() === serverAddress.toString()) {
          throw new PaymentVerificationError(
            '[stellar:charge] Server address must not appear in client auth entries.',
            { serverAddress: serverPublicKey },
          )
        }

        if (maxLedger !== undefined) {
          const entryExpiration = addressCred.signatureExpirationLedger()
          if (entryExpiration > maxLedger) {
            throw new PaymentVerificationError(
              '[stellar:charge] Auth entry expiration exceeds maximum allowed ledger.',
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
            '[stellar:charge] Auth entries must not contain sub-invocations.',
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
  const invokeOps = tx.operations.filter((op) => op.type === 'invokeHostFunction')

  if (invokeOps.length === 0) {
    throw new PaymentVerificationError(
      '[stellar:charge] Transaction does not contain a Soroban invocation.',
      {},
    )
  }
  if (invokeOps.length > 1) {
    throw new PaymentVerificationError(
      '[stellar:charge] Transaction must contain exactly one invokeHostFunction operation.',
      { operationCount: invokeOps.length },
    )
  }
}

function verifySacInvocation(
  tx: Transaction,
  expected: { amount: bigint; currency: string; recipient: string },
) {
  verifyFromRawOps(tx, expected)
}

function verifyFromRawOps(
  tx: Transaction,
  expected: { amount: bigint; currency: string; recipient: string },
) {
  let found = false
  const xdrEnvelope = tx.toXDR()
  const envelope = xdr.TransactionEnvelope.fromXDR(xdrEnvelope, 'base64')
  const txBody = envelope.v1().tx()
  const ops = txBody.operations()

  for (let i = 0; i < ops.length; i++) {
    const opBody = ops[i].body()
    if (opBody.switch().value !== xdr.OperationType.invokeHostFunction().value) {
      continue
    }

    const hostFn = opBody.invokeHostFunctionOp().hostFunction()
    if (hostFn.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value) {
      continue
    }

    const invokeArgs = hostFn.invokeContract()
    const contractAddress = Address.fromScAddress(invokeArgs.contractAddress()).toString()
    const functionName = invokeArgs.functionName().toString()
    const args = invokeArgs.args()

    if (functionName !== 'transfer') continue
    if (contractAddress !== expected.currency) continue
    if (args.length < 3) continue

    const toAddress = Address.fromScVal(args[1]).toString()
    if (toAddress !== expected.recipient) continue

    const amountVal = scValToBigInt(args[2])
    if (amountVal !== expected.amount) continue

    found = true
    break
  }

  if (!found) {
    throw new PaymentVerificationError(
      '[stellar:charge] Transaction does not contain a matching SAC transfer invocation.',
      {
        currency: expected.currency,
        recipient: expected.recipient,
        amount: expected.amount.toString(),
      },
    )
  }
}

function verifySacTransfer(
  txResult: rpc.Api.GetSuccessfulTransactionResponse,
  expected: { amount: bigint; currency: string; recipient: string },
  networkPassphrase: string,
) {
  if (!txResult.envelopeXdr) {
    throw new PaymentVerificationError(
      '[stellar:charge] Transaction result is missing envelope XDR — cannot verify payment.',
      {},
    )
  }

  let envelope: xdr.TransactionEnvelope
  if (typeof txResult.envelopeXdr === 'string') {
    try {
      envelope = xdr.TransactionEnvelope.fromXDR(txResult.envelopeXdr, 'base64')
    } catch (error) {
      throw new PaymentVerificationError(
        '[stellar:charge] Could not parse transaction envelope for verification.',
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
      '[stellar:charge] Could not parse transaction envelope for verification.',
      {},
    )
  }

  verifyFromRawOps(innerTx, expected)
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
) {
  const transferEvents: Array<{ from: string; to: string; amount: bigint; contract: string }> = []

  for (const event of events) {
    try {
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
    } catch {
      // Skip events we can't parse
      continue
    }
  }

  if (transferEvents.length === 0) return

  // Verify at least one transfer matches expected parameters
  const matchingTransfer = transferEvents.find(
    (t) =>
      t.to === expectedRecipient && t.amount === expectedAmount && t.contract === expectedCurrency,
  )

  if (!matchingTransfer) {
    throw new PaymentVerificationError(
      '[stellar:charge] Simulation events do not contain expected transfer.',
      {
        expectedRecipient,
        expectedAmount: expectedAmount.toString(),
        expectedCurrency,
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
        '[stellar:charge] Server address must not be involved in transfer events.',
        { serverAddress },
      )
    }
  }
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
    signer?: Keypair | string
    feeBumpSigner?: Keypair | string
    store?: Store.Store
    maxFeeBumpStroops?: number
    pollMaxAttempts?: number
    pollDelayMs?: number
    pollTimeoutMs?: number
    simulationTimeoutMs?: number
    logger?: Logger
  }
}
