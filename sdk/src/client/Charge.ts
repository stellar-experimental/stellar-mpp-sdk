import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Memo,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'
import { Credential, Method } from 'mppx'
import { z } from 'zod/mini'
import {
  DEFAULT_TIMEOUT,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../constants.js'
import * as Methods from '../Methods.js'
import { fromBaseUnits } from '../Methods.js'

/**
 * Creates a Stellar charge method for use on the **client**.
 *
 * Builds a Soroban SAC `transfer` invocation, signs it, and either:
 * - **pull** (default): sends the signed XDR to the server to broadcast
 * - **push**: broadcasts itself and sends the tx hash
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk'
 * import { Mppx } from 'mppx/client'
 * import { stellar } from 'stellar-mpp-sdk/client'
 *
 * Mppx.create({
 *   methods: [
 *     stellar.charge({
 *       keypair: Keypair.fromSecret('S...'),
 *     }),
 *   ],
 * })
 *
 * const response = await fetch('https://api.example.com/resource')
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const {
    keypair: keypairParam,
    mode: defaultMode = 'pull',
    onProgress,
    rpcUrl,
    secretKey,
    timeout = DEFAULT_TIMEOUT,
  } = parameters

  if (!keypairParam && !secretKey) {
    throw new Error(
      'Either keypair or secretKey must be provided.',
    )
  }

  const keypair = keypairParam ?? Keypair.fromSecret(secretKey!)

  return Method.toClient(Methods.charge, {
    context: z.object({
      mode: z.optional(z.enum(['push', 'pull'])),
    }),
    async createCredential({ challenge, context }) {
      const { request } = challenge
      const { amount, currency, recipient } = request
      const network: NetworkId =
        (request.methodDetails?.network as NetworkId) ?? 'testnet'
      const memo = request.methodDetails?.memo as string | undefined
      const feePayerKey = request.methodDetails?.feePayerKey

      onProgress?.({
        type: 'challenge',
        recipient,
        amount: fromBaseUnits(amount, 7),
        currency,
        ...(feePayerKey ? { feePayerKey } : {}),
      })

      const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
      const networkPassphrase = NETWORK_PASSPHRASE[network]
      const server = new rpc.Server(resolvedRpcUrl)

      // Load source account via Soroban RPC
      const sourceAccount = await server.getAccount(keypair.publicKey())

      // Build SAC `transfer(from, to, amount)` invocation
      const contract = new Contract(currency)
      const stellarAmount = BigInt(amount)

      const transferOp = contract.call(
        'transfer',
        new Address(keypair.publicKey()).toScVal(),
        new Address(recipient).toScVal(),
        nativeToScVal(stellarAmount, { type: 'i128' }),
      )

      const builder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(transferOp)
        .setTimeout(timeout)

      if (memo) {
        builder.addMemo(Memo.text(memo))
      }

      const transaction = builder.build()

      // Simulate to attach Soroban resource data
      const prepared = await server.prepareTransaction(transaction)

      onProgress?.({ type: 'signing' })
      prepared.sign(keypair)

      const signedXdr = prepared.toXDR()
      onProgress?.({ type: 'signed', xdr: signedXdr })

      const effectiveMode = context?.mode ?? defaultMode

      if (effectiveMode === 'push') {
        // Client broadcasts
        onProgress?.({ type: 'paying' })
        const result = await server.sendTransaction(prepared)

        // Poll until confirmed
        onProgress?.({ type: 'confirming', hash: result.hash })
        let txResult = await server.getTransaction(result.hash)
        let pollAttempts = 0
        while (txResult.status === 'NOT_FOUND') {
          if (++pollAttempts >= 60) {
            throw new Error(
              `Transaction not confirmed after ${pollAttempts} attempts.`,
            )
          }
          await new Promise((r) => setTimeout(r, 1000))
          txResult = await server.getTransaction(result.hash)
        }

        if (txResult.status !== 'SUCCESS') {
          throw new Error(
            `Transaction failed: ${txResult.status}`,
          )
        }

        onProgress?.({ type: 'paid', hash: result.hash })

        return Credential.serialize({
          challenge,
          payload: { type: 'signature' as const, hash: result.hash },
        })
      }

      // Pull mode: send signed XDR for server to broadcast
      return Credential.serialize({
        challenge,
        payload: {
          type: 'transaction' as const,
          xdr: signedXdr,
        },
      })
    },
  })
}

export declare namespace charge {
  type ProgressEvent =
    | { type: 'challenge'; recipient: string; amount: string; currency: string; feePayerKey?: string }
    | { type: 'signing' }
    | { type: 'signed'; xdr: string }
    | { type: 'paying' }
    | { type: 'confirming'; hash: string }
    | { type: 'paid'; hash: string }

  type Parameters = {
    /** Stellar secret key (S...). Provide either this or `keypair`. */
    secretKey?: string
    /** Stellar Keypair instance. Provide either this or `secretKey`. */
    keypair?: Keypair
    /** Custom Soroban RPC URL. Defaults based on network. */
    rpcUrl?: string
    /**
     * Controls how the charge transaction is submitted.
     *
     * - `'push'`: Client broadcasts the transaction and sends the tx hash.
     * - `'pull'`: Client signs the transaction and sends the signed XDR
     *   to the server for broadcast.
     *
     * @default 'pull'
     */
    mode?: 'push' | 'pull'
    /** Transaction timeout in seconds. @default 180 */
    timeout?: number
    /** Callback invoked at each lifecycle stage. */
    onProgress?: (event: ProgressEvent) => void
  }
}
