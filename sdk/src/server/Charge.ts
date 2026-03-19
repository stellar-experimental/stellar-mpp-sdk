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

  // Determine network passphrase — try testnet first, then mainnet
  let innerTx: Transaction | null = null
  for (const np of [NETWORK_PASSPHRASE.testnet, NETWORK_PASSPHRASE.public]) {
    try {
      innerTx = new Transaction(envelope, np)
      break
    } catch {
      continue
    }
  }

  if (!innerTx) {
    throw new PaymentVerificationError(
      'Could not parse transaction envelope for verification.',
      {},
    )
  }

  verifyFromRawOps(innerTx, expected)
}

function scValToBigInt(val: xdr.ScVal): bigint {
  const switchValue = val.switch().value
  // scvU32 = 3
  if (switchValue === xdr.ScValType.scvU32().value) {
    return BigInt(val.u32())
  }
  // scvI32 = 4
  if (switchValue === xdr.ScValType.scvI32().value) {
    return BigInt(val.i32())
  }
  // scvU64 = 5
  if (switchValue === xdr.ScValType.scvU64().value) {
    return BigInt(val.u64().toString())
  }
  // scvI64 = 6
  if (switchValue === xdr.ScValType.scvI64().value) {
    return BigInt(val.i64().toString())
  }
  // scvU128 = 9
  if (switchValue === xdr.ScValType.scvU128().value) {
    const parts = val.u128()
    const hi = BigInt(parts.hi().toString())
    const lo = BigInt(parts.lo().toString()) & 0xFFFFFFFFFFFFFFFFn
    return (hi << 64n) | lo
  }
  // scvI128 = 10
  if (switchValue === xdr.ScValType.scvI128().value) {
    const parts = val.i128()
    const hi = BigInt(parts.hi().toString())
    const lo = BigInt(parts.lo().toString()) & 0xFFFFFFFFFFFFFFFFn
    return (hi << 64n) | lo
  }
  throw new Error(`Cannot convert ScVal type ${switchValue} to BigInt`)
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
