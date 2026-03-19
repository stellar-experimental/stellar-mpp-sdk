import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'
import { Method, Receipt, Store } from 'mppx'
import {
  DEFAULT_DECIMALS,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../../constants.js'
import { toBaseUnits } from '../../Methods.js'
import { channel as ChannelMethod } from '../Methods.js'

/**
 * Creates a Stellar one-way-channel method for use on the **server**.
 *
 * The server:
 * 1. Issues challenges with the channel contract address and cumulative amount
 * 2. Verifies commitment signatures against the channel's commitment key
 * 3. Optionally withdraws accumulated funds on-chain
 *
 * @example
 * ```ts
 * import { stellar } from 'stellar-mpp-sdk/channel/server'
 * import { Mppx } from 'mppx/server'
 *
 * const mppx = Mppx.create({
 *   secretKey: 'my-secret',
 *   methods: [
 *     stellar.channel({
 *       channel: 'C...',          // on-chain channel contract
 *       commitmentKey: 'GABC...', // ed25519 public key for verifying commitments
 *     }),
 *   ],
 * })
 * ```
 */
export function channel(parameters: channel.Parameters) {
  const {
    channel: channelAddress,
    commitmentKey: commitmentKeyParam,
    decimals = DEFAULT_DECIMALS,
    network = 'testnet',
    rpcUrl,
    store,
    withdrawKey,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  // Parse the commitment public key (accepts G... string or raw hex)
  const commitmentKeypair = (() => {
    if (typeof commitmentKeyParam === 'string') {
      // Could be a Stellar public key (G...) — create a verify-only Keypair
      return Keypair.fromPublicKey(commitmentKeyParam)
    }
    return commitmentKeyParam
  })()

  // Track cumulative amounts per channel in the store
  const cumulativeKey = `stellar:channel:cumulative:${channelAddress}`

  return Method.toServer(ChannelMethod, {
    defaults: {
      channel: channelAddress,
    },
    async request({ request }) {
      // Retrieve current cumulative amount from store
      let currentCumulative = '0'
      if (store) {
        const stored = await store.get(cumulativeKey)
        if (stored && typeof stored === 'object' && 'amount' in stored) {
          currentCumulative = (stored as { amount: string }).amount
        }
      }

      return {
        ...request,
        amount: toBaseUnits(request.amount, decimals),
        methodDetails: {
          ...request.methodDetails,
          reference: crypto.randomUUID(),
          network,
          cumulativeAmount: currentCumulative,
        },
      }
    },
    async verify({ credential }) {
      const { challenge } = credential
      const { request: challengeRequest } = challenge

      // Replay protection
      if (store) {
        const replayKey = `stellar:challenge:${challenge.id}`
        const existing = await store.get(replayKey)
        if (existing) {
          throw new Error('Challenge already used. Replay rejected.')
        }
        await store.put(replayKey, { usedAt: new Date().toISOString() })
      }

      const payload = credential.payload
      const commitmentAmount = BigInt(payload.amount)
      const signatureHex = payload.signature
      const signatureBytes = Buffer.from(signatureHex, 'hex')

      // Retrieve the previous cumulative amount
      let previousCumulative = 0n
      if (store) {
        const stored = await store.get(cumulativeKey)
        if (stored && typeof stored === 'object' && 'amount' in stored) {
          previousCumulative = BigInt((stored as { amount: string }).amount)
        }
      }

      // The new cumulative must be >= previous cumulative
      if (commitmentAmount < previousCumulative) {
        throw new ChannelVerificationError(
          `Commitment amount ${commitmentAmount} is less than previous cumulative ${previousCumulative}.`,
          {
            commitmentAmount: commitmentAmount.toString(),
            previousCumulative: previousCumulative.toString(),
          },
        )
      }

      // Verify: call prepare_commitment on the channel contract to
      // reconstruct the expected commitment bytes, then verify the
      // ed25519 signature.
      const contract = new Contract(channelAddress)
      const call = contract.call(
        'prepare_commitment',
        nativeToScVal(commitmentAmount, { type: 'i128' }),
      )

      const account = await server.getAccount(
        commitmentKeypair.publicKey(),
      )
      const simTx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase,
      })
        .addOperation(call)
        .setTimeout(30)
        .build()

      const simResult = await server.simulateTransaction(simTx)

      if (!rpc.Api.isSimulationSuccess(simResult)) {
        throw new ChannelVerificationError(
          'Failed to simulate prepare_commitment for verification.',
          {
            error:
              'error' in simResult
                ? String(simResult.error)
                : 'unknown',
          },
        )
      }

      const returnValue = simResult.result?.retval
      if (!returnValue) {
        throw new ChannelVerificationError(
          'prepare_commitment returned no value.',
          {},
        )
      }

      const commitmentBytes = returnValue.bytes()

      // Verify the ed25519 signature
      const valid = commitmentKeypair.verify(
        Buffer.from(commitmentBytes),
        signatureBytes,
      )

      if (!valid) {
        throw new ChannelVerificationError(
          'Commitment signature verification failed.',
          {
            amount: commitmentAmount.toString(),
            channel: channelAddress,
          },
        )
      }

      // Update cumulative amount in store
      if (store) {
        await store.put(cumulativeKey, {
          amount: commitmentAmount.toString(),
        })
      }

      // Calculate the incremental payment
      const incrementalAmount = commitmentAmount - previousCumulative

      return Receipt.from({
        method: 'stellar',
        reference: challengeRequest.methodDetails?.reference ?? challenge.id,
        status: 'success',
        timestamp: new Date().toISOString(),
      })
    },
  })
}

/**
 * Withdraw funds from the channel contract on-chain using the latest
 * commitment. This is a server-side administrative operation.
 */
export async function withdraw(parameters: {
  /** Channel contract address. */
  channel: string
  /** Cumulative amount to withdraw. */
  amount: bigint
  /** Ed25519 signature for the commitment. */
  signature: Uint8Array
  /** Keypair to sign the withdrawal transaction. */
  withdrawKey: Keypair
  /** Network identifier. */
  network?: NetworkId
  /** Custom RPC URL. */
  rpcUrl?: string
}): Promise<string> {
  const {
    channel: channelAddress,
    amount,
    signature,
    withdrawKey,
    network = 'testnet',
    rpcUrl,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const contract = new Contract(channelAddress)
  const withdrawOp = contract.call(
    'withdraw',
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(Buffer.from(signature), { type: 'bytes' }),
  )

  const account = await server.getAccount(withdrawKey.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(withdrawOp)
    .setTimeout(180)
    .build()

  const prepared = await server.prepareTransaction(tx)
  prepared.sign(withdrawKey)

  const result = await server.sendTransaction(prepared)

  let txResult = await server.getTransaction(result.hash)
  while (txResult.status === 'NOT_FOUND') {
    await new Promise((r) => setTimeout(r, 1000))
    txResult = await server.getTransaction(result.hash)
  }

  if (txResult.status !== 'SUCCESS') {
    throw new ChannelVerificationError(
      `Withdraw transaction failed: ${txResult.status}`,
      { hash: result.hash, status: txResult.status },
    )
  }

  return result.hash
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export declare namespace channel {
  type Parameters = {
    /** On-chain channel contract address (C...). */
    channel: string
    /**
     * Ed25519 public key for verifying commitment signatures.
     * Accepts a Stellar public key string (G...) or a Keypair instance.
     */
    commitmentKey: string | Keypair
    /** Number of decimal places for amount conversion. @default 7 */
    decimals?: number
    /** Stellar network. @default 'testnet' */
    network?: NetworkId
    /** Custom Soroban RPC URL. */
    rpcUrl?: string
    /** Store for replay protection and cumulative amount tracking. */
    store?: Store.Store
    /** Keypair for signing on-chain withdraw transactions. */
    withdrawKey?: Keypair
  }
}

class ChannelVerificationError extends Error {
  details: Record<string, string>

  constructor(message: string, details: Record<string, string>) {
    super(message)
    this.name = 'ChannelVerificationError'
    this.details = details
  }
}
