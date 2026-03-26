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
  DEFAULT_DECIMALS,
  DEFAULT_TIMEOUT,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../constants.js'
import * as Methods from '../Methods.js'
import { toBaseUnits } from '../Methods.js'
import { scValToBigInt } from '../scval.js'
import { resolveKeypair } from '../signers.js'

export function charge(parameters: charge.Parameters) {
  const {
    currency,
    decimals = DEFAULT_DECIMALS,
    feeBumpSigner: feeBumpSignerParam,
    network = 'testnet',
    recipient,
    rpcUrl,
    signer: signerParam,
    store,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const signerKeypair = signerParam ? resolveKeypair(signerParam) : undefined

  const feeBumpKeypair = feeBumpSignerParam
    ? resolveKeypair(feeBumpSignerParam)
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
          ...request.methodDetails,
          reference: crypto.randomUUID(),
          network,
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
        const key = `stellar:challenge:${challenge.id}`
        const existing = await store.get(key)
        if (existing) {
          throw new Error(
            'Challenge already used. Replay rejected.',
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
            const hashKey = `stellar:tx:${hash}`
            const hashUsed = await store.get(hashKey)
            if (hashUsed) {
              throw new PaymentVerificationError(
                'Transaction hash already used. Replay rejected.',
                { hash },
              )
            }
          }

          let txResult = await server.getTransaction(hash)
          let attempts = 0
          while (txResult.status === 'NOT_FOUND' && attempts < 10) {
            await new Promise((r) => setTimeout(r, 1000))
            txResult = await server.getTransaction(hash)
            attempts++
          }

          if (txResult.status !== 'SUCCESS') {
            throw new PaymentVerificationError(
              `Transaction ${hash} is not successful (status: ${txResult.status}).`,
              { hash, status: txResult.status },
            )
          }

          verifySacTransfer(txResult, {
            amount: expectedAmount,
            currency: expectedCurrency,
            recipient: expectedRecipient,
          }, networkPassphrase)

          // Mark tx hash as used only after successful verification
          if (store) {
            await store.put(`stellar:tx:${hash}`, { usedAt: new Date().toISOString() })
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
          const parsed = TransactionBuilder.fromXDR(
            txXdr,
            networkPassphrase,
          )

          const tx =
            parsed instanceof FeeBumpTransaction
              ? parsed.innerTransaction
              : (parsed as Transaction)

          verifySacInvocation(tx, {
            amount: expectedAmount,
            currency: expectedCurrency,
            recipient: expectedRecipient,
          })

          let txToSubmit: Transaction | FeeBumpTransaction = parsed as
            | Transaction
            | FeeBumpTransaction

          if (!signerKeypair && tx.source === ALL_ZEROS) {
            throw new PaymentVerificationError(
              'Transaction uses a sponsored source account but the server is not configured with a signer.',
              {},
            )
          }

          if (signerKeypair && tx.source === ALL_ZEROS) {
            // ── Sponsored path ──────────────────────────────────────────
            // Client used all-zeros source; rebuild the tx with the
            // signer's account as source.
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
            rebuiltTx.sign(signerKeypair)
            txToSubmit = rebuiltTx
          }

          // ── Fee bump wrapping ───────────────────────────────────────
          // When feeBumpSigner is set, wrap in a FeeBumpTransaction.
          // Applies to both sponsored and unsponsored paths.
          // NM-004: Cap the fee-bump to prevent draining the fee payer.
          if (feeBumpKeypair && !(txToSubmit instanceof FeeBumpTransaction)) {
            const MAX_FEE_BUMP = 10_000_000 // 1 XLM in stroops
            const bumpFee = Math.min(
              Number((txToSubmit as Transaction).fee) * 10,
              MAX_FEE_BUMP,
            )
            txToSubmit = TransactionBuilder.buildFeeBumpTransaction(
              feeBumpKeypair,
              bumpFee.toString(),
              txToSubmit as Transaction,
              networkPassphrase,
            )
            txToSubmit.sign(feeBumpKeypair)
          }

          const sendResult = await server.sendTransaction(txToSubmit)

          let txResult = await server.getTransaction(sendResult.hash)
          let txAttempts = 0
          while (txResult.status === 'NOT_FOUND') {
            if (++txAttempts >= 60) {
              throw new PaymentVerificationError(
                `Transaction not found after ${txAttempts} polling attempts.`,
                { hash: sendResult.hash },
              )
            }
            await new Promise((r) => setTimeout(r, 1000))
            txResult = await server.getTransaction(sendResult.hash)
          }

          if (txResult.status !== 'SUCCESS') {
            throw new PaymentVerificationError(
              `Transaction failed on-chain: ${txResult.status}`,
              { hash: sendResult.hash, status: txResult.status },
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
          throw new Error(
            `Unsupported credential type "${(payload as { type: string }).type}".`,
          )
      }
  }
}

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

function verifySacInvocation(
  tx: Transaction,
  expected: { amount: bigint; currency: string; recipient: string },
) {
  const invokeOp = tx.operations.find(
    (op) => op.type === 'invokeHostFunction',
  )

  if (!invokeOp) {
    throw new PaymentVerificationError(
      'Transaction does not contain a Soroban invocation.',
      {},
    )
  }

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
    const contractAddress = Address.fromScAddress(
      invokeArgs.contractAddress(),
    ).toString()
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
      'Transaction does not contain a matching SAC transfer invocation.',
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
      'Transaction result is missing envelope XDR — cannot verify payment.',
      {},
    )
  }

  let envelope: xdr.TransactionEnvelope
  if (typeof txResult.envelopeXdr === 'string') {
    try {
      envelope = xdr.TransactionEnvelope.fromXDR(
        txResult.envelopeXdr,
        'base64',
      )
    } catch (error) {
      throw new PaymentVerificationError(
        'Could not parse transaction envelope for verification.',
        {
          details:
            error instanceof Error ? error.message : String(error),
        },
      )
    }
  } else {
    envelope = txResult.envelopeXdr
  }

  // NM-009: Use the configured network passphrase instead of guessing.
  let innerTx: Transaction
  try {
    innerTx = new Transaction(envelope, networkPassphrase)
  } catch {
    throw new PaymentVerificationError(
      'Could not parse transaction envelope for verification.',
      {},
    )
  }

  verifyFromRawOps(innerTx, expected)
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
    /** Keypair providing source account for sponsored transactions. */
    signer?: Keypair | string
    /**
     * Optional fee bump signer. Wraps non-fee-bump transactions in a
     * FeeBumpTransaction; if a FeeBumpTransaction is already provided, it is
     * submitted as-is.
     */
    feeBumpSigner?: Keypair | string
    store?: Store.Store
  }
}

class PaymentVerificationError extends Error {
  details: Record<string, string>

  constructor(message: string, details: Record<string, string>) {
    super(message)
    this.name = 'PaymentVerificationError'
    this.details = details
  }
}
