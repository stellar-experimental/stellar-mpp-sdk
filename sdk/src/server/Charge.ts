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
  DEFAULT_DECIMALS,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../constants.js'
import * as Methods from '../Methods.js'
import { toBaseUnits } from '../Methods.js'

export function charge(parameters: charge.Parameters) {
  const {
    currency,
    decimals = DEFAULT_DECIMALS,
    feePayer,
    network = 'testnet',
    recipient,
    rpcUrl,
    store,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const feePayerPublicKey = feePayer
    ? (typeof feePayer === 'string'
        ? Keypair.fromSecret(feePayer)
        : feePayer
      ).publicKey()
    : undefined

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
          ...(feePayerPublicKey
            ? { feePayer: true, feePayerKey: feePayerPublicKey }
            : {}),
        },
      }
    },
    async verify({ credential }) {
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
        case 'signature': {
          const hash = payload.hash

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
          })

          return Receipt.from({
            method: 'stellar',
            reference: hash,
            status: 'success',
            timestamp: new Date().toISOString(),
          })
        }

        case 'transaction': {
          const txXdr = payload.xdr
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

          if (feePayer && !(parsed instanceof FeeBumpTransaction)) {
            const feePayerKeypair =
              typeof feePayer === 'string'
                ? Keypair.fromSecret(feePayer)
                : feePayer
            txToSubmit = TransactionBuilder.buildFeeBumpTransaction(
              feePayerKeypair,
              (Number(tx.fee) * 10).toString(),
              tx,
              networkPassphrase,
            )
            txToSubmit.sign(feePayerKeypair)
          }

          const sendResult = await server.sendTransaction(txToSubmit)

          let txResult = await server.getTransaction(sendResult.hash)
          while (txResult.status === 'NOT_FOUND') {
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
    },
  })
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
  const env = tx.toEnvelope()
  const txBody = env.v1().tx()
  const ops = txBody.operations()

  let found = false

  for (const op of ops) {
    if (op.body().switch().name !== 'invokeHostFunction') {
      continue
    }

    const hostFn = op.body().invokeHostFunctionOp().hostFunction()
    if (hostFn.switch().name !== 'hostFunctionTypeInvokeContract') {
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
) {
  if (txResult.envelopeXdr) {
    const envelope =
      typeof txResult.envelopeXdr === 'string'
        ? xdr.TransactionEnvelope.fromXDR(txResult.envelopeXdr, 'base64')
        : txResult.envelopeXdr

    const innerTx = envelope.v1()
      ? new Transaction(envelope, NETWORK_PASSPHRASE.testnet)
      : null

    if (innerTx) {
      verifyFromRawOps(innerTx, expected)
      return
    }
  }
}

function scValToBigInt(val: xdr.ScVal): bigint {
  switch (val.switch().value) {
    case xdr.ScValType.scvI128().value: {
      const parts = val.i128()
      const hi = BigInt(parts.hi().toString())
      const lo = BigInt(parts.lo().toString())
      return (hi << 64n) | lo
    }
    case xdr.ScValType.scvU64().value:
      return BigInt(val.u64().toString())
    case xdr.ScValType.scvI64().value:
      return BigInt(val.i64().toString())
    default:
      throw new Error(`Cannot convert ScVal type ${val.switch().name} to BigInt`)
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
    feePayer?: Keypair | string
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
