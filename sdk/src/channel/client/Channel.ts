import {
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'
import { Credential, Method } from 'mppx'
import { z } from 'zod/mini'
import {
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../../constants.js'
import { channel as ChannelMethod } from '../Methods.js'

/**
 * Creates a Stellar one-way-channel method for use on the **client**.
 *
 * Instead of building a full Soroban transaction per payment, the client
 * signs an ed25519 commitment authorising the recipient to close the channel and receive up
 * to a cumulative amount from the on-chain channel contract.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk'
 * import { Mppx } from 'mppx/client'
 * import { stellar } from 'stellar-mpp-sdk/channel/client'
 *
 * Mppx.create({
 *   methods: [
 *     stellar.channel({
 *       commitmentKey: Keypair.fromSecret('S...'),
 *     }),
 *   ],
 * })
 * ```
 */
export function channel(parameters: channel.Parameters) {
  const {
    commitmentKey: commitmentKeyParam,
    commitmentSecret,
    onProgress,
    rpcUrl,
    sourceAccount,
  } = parameters

  if (!commitmentKeyParam && !commitmentSecret) {
    throw new Error(
      'Either commitmentKey or commitmentSecret must be provided.',
    )
  }

  const commitmentKey =
    commitmentKeyParam ?? Keypair.fromSecret(commitmentSecret!)

  return Method.toClient(ChannelMethod, {
    context: z.object({
      /** Override the cumulative amount to commit. */
      cumulativeAmount: z.optional(z.string()),
      /** Credential action: 'voucher' (default), 'close', or 'open'. */
      action: z.optional(z.enum(['voucher', 'close', 'open'])),
      /** Signed channel-open transaction XDR (base64). Required when action is 'open'. */
      openTransaction: z.optional(z.string()),
    }),
    async createCredential({ challenge, context }) {
      const { request } = challenge
      const { amount, channel: channelAddress } = request
      const network: NetworkId =
        (request.methodDetails?.network as NetworkId) ?? 'testnet'

      // The server tells us the cumulative amount via methodDetails,
      // or the caller can override via context.
      const action = context?.action ?? 'voucher'

      // For open actions, default cumulative amount to the requested amount
      // (first payment). The caller must also provide the signed open tx XDR.
      if (action === 'open') {
        if (!context?.openTransaction) {
          throw new Error(
            'openTransaction is required when action is "open".',
          )
        }
      }

      const previousCumulative = BigInt(
        request.methodDetails?.cumulativeAmount ?? '0',
      )
      const cumulativeAmount =
        context?.cumulativeAmount !== undefined
          ? BigInt(context.cumulativeAmount)
          : previousCumulative + BigInt(amount)

      onProgress?.({
        type: 'challenge',
        channel: channelAddress,
        amount,
        cumulativeAmount: cumulativeAmount.toString(),
      })

      // Call prepare_commitment on the channel contract (read-only)
      const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
      const networkPassphrase = NETWORK_PASSPHRASE[network]
      const server = new rpc.Server(resolvedRpcUrl)

      const contract = new Contract(channelAddress)
      const call = contract.call(
        'prepare_commitment',
        nativeToScVal(cumulativeAmount, { type: 'i128' }),
      )

      // Simulate the call to get the commitment bytes
      const account = await server.getAccount(
        sourceAccount ?? commitmentKey.publicKey(),
      )
      const { TransactionBuilder } = await import('@stellar/stellar-sdk')
      const simTx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase,
      })
        .addOperation(call)
        .setTimeout(30)
        .build()

      const simResult = await server.simulateTransaction(simTx)

      if (!rpc.Api.isSimulationSuccess(simResult)) {
        throw new Error(
          `Failed to simulate prepare_commitment: ${
            'error' in simResult ? simResult.error : 'unknown error'
          }`,
        )
      }

      // Extract the commitment bytes from the simulation result
      const returnValue = simResult.result?.retval
      if (!returnValue) {
        throw new Error('prepare_commitment returned no value')
      }

      const commitmentBytes = returnValue.bytes()

      onProgress?.({ type: 'signing' })

      // Sign the commitment bytes with the ed25519 commitment key
      const signature = commitmentKey.sign(Buffer.from(commitmentBytes))

      // Convert signature to hex string
      const sigHex = signature.toString('hex')

      onProgress?.({
        type: 'signed',
        cumulativeAmount: cumulativeAmount.toString(),
      })

      return Credential.serialize({
        challenge,
        payload: {
          action,
          ...(action === 'open' ? { transaction: context!.openTransaction! } : {}),
          amount: cumulativeAmount.toString(),
          signature: sigHex,
        },
      })
    },
  })
}

export declare namespace channel {
  type ProgressEvent =
    | {
        type: 'challenge'
        channel: string
        amount: string
        cumulativeAmount: string
      }
    | { type: 'signing' }
    | { type: 'signed'; cumulativeAmount: string }

  type Parameters = {
    /** Ed25519 secret key (S...) for signing commitments. Provide either this or `commitmentKey`. */
    commitmentSecret?: string
    /** Stellar Keypair for signing commitments. Provide either this or `commitmentSecret`. */
    commitmentKey?: Keypair
    /** Custom Soroban RPC URL. Defaults based on network. */
    rpcUrl?: string
    /**
     * Funded Stellar account address (G...) used as the source for
     * read-only transaction simulations. If omitted, the commitment
     * key's public key is used, which requires it to be a funded account.
     */
    sourceAccount?: string
    /** Callback invoked at each lifecycle stage. */
    onProgress?: (event: ProgressEvent) => void
  }
}
