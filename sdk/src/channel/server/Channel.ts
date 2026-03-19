import {
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
import { withKeyLock } from '../../internal/withKeyLock.js'
import { toBaseUnits } from '../../Methods.js'
import { channel as ChannelMethod } from '../Methods.js'

/**
 * Creates a Stellar one-way-channel method for use on the **server**.
 *
 * The server:
 * 1. Issues challenges with the channel contract address and cumulative amount
 * 2. Verifies commitment signatures against the channel's commitment key
 * 3. Optionally closes the channel and settles funds on-chain
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
    sourceAccount,
    store,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  // Parse the commitment public key (accepts G... Stellar public key string or Keypair)
  const commitmentKeypair = (() => {
    if (typeof commitmentKeyParam === 'string') {
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
      return withKeyLock(
        `stellar:channel:verify:${channelAddress}`,
        async () => {
          const { request: challengeRequest } = challenge

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

          if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length % 2 !== 0) {
            throw new ChannelVerificationError(
              'Invalid signature: not a valid hex string.',
              { signature: signatureHex },
            )
          }
          if (signatureHex.length !== 128) {
            throw new ChannelVerificationError(
              `Invalid signature length: expected 128 hex chars (64 bytes), got ${signatureHex.length}.`,
              { length: String(signatureHex.length) },
            )
          }
          const signatureBytes = Buffer.from(signatureHex, 'hex')

          let previousCumulative = 0n
          if (store) {
            const stored = await store.get(cumulativeKey)
            if (stored && typeof stored === 'object' && 'amount' in stored) {
              previousCumulative = BigInt((stored as { amount: string }).amount)
            }
          }

          if (commitmentAmount < previousCumulative) {
            throw new ChannelVerificationError(
              `Commitment amount ${commitmentAmount} is less than previous cumulative ${previousCumulative}.`,
              {
                commitmentAmount: commitmentAmount.toString(),
                previousCumulative: previousCumulative.toString(),
              },
            )
          }

          const requestedAmount = BigInt(challengeRequest.amount)
          if (commitmentAmount < previousCumulative + requestedAmount) {
            throw new ChannelVerificationError(
              `Commitment amount ${commitmentAmount} does not cover the requested amount ${requestedAmount} (previous cumulative: ${previousCumulative}).`,
              {
                commitmentAmount: commitmentAmount.toString(),
                requestedAmount: requestedAmount.toString(),
                previousCumulative: previousCumulative.toString(),
              },
            )
          }

          const contract = new Contract(channelAddress)
          const call = contract.call(
            'prepare_commitment',
            nativeToScVal(commitmentAmount, { type: 'i128' }),
          )

          const account = await server.getAccount(
            sourceAccount ?? commitmentKeypair.publicKey(),
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

          if (store) {
            await store.put(cumulativeKey, {
              amount: commitmentAmount.toString(),
            })
          }

          return Receipt.from({
            method: 'stellar',
            reference: challengeRequest.methodDetails?.reference ?? challenge.id,
            status: 'success',
            timestamp: new Date().toISOString(),
          })
        },
      )
    },
  })
}

/**
 * Close the channel contract on-chain using a signed commitment.
 * Transfers the committed amount to the recipient and auto-refunds
 * the remaining balance to the funder. This is a server-side
 * administrative operation.
 */
export async function close(parameters: {
  /** Channel contract address. */
  channel: string
  /** Commitment amount to close with. */
  amount: bigint
  /** Ed25519 signature for the commitment. */
  signature: Uint8Array
  /** Keypair to sign the close transaction. */
  closeKey: Keypair
  /** Network identifier. */
  network?: NetworkId
  /** Custom RPC URL. */
  rpcUrl?: string
}): Promise<string> {
  const {
    channel: channelAddress,
    amount,
    signature,
    closeKey,
    network = 'testnet',
    rpcUrl,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const contract = new Contract(channelAddress)
  const closeOp = contract.call(
    'close',
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(Buffer.from(signature), { type: 'bytes' }),
  )

  const account = await server.getAccount(closeKey.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(closeOp)
    .setTimeout(180)
    .build()

  const prepared = await server.prepareTransaction(tx)
  prepared.sign(closeKey)

  const result = await server.sendTransaction(prepared)

  const MAX_POLL_ATTEMPTS = 60
  let txResult = await server.getTransaction(result.hash)
  let attempts = 0
  while (txResult.status === 'NOT_FOUND') {
    if (++attempts >= MAX_POLL_ATTEMPTS) {
      throw new ChannelVerificationError(
        `Transaction not found after ${MAX_POLL_ATTEMPTS} attempts.`,
        { hash: result.hash },
      )
    }
    await new Promise((r) => setTimeout(r, 1000))
    txResult = await server.getTransaction(result.hash)
  }

  if (txResult.status !== 'SUCCESS') {
    throw new ChannelVerificationError(
      `Close transaction failed: ${txResult.status}`,
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
    /**
     * Funded Stellar account address (G...) used as the source for
     * read-only transaction simulations. If omitted, the commitment
     * key's public key is used, which requires it to be a funded account.
     */
    sourceAccount?: string
    /** Store for replay protection and cumulative amount tracking. */
    store?: Store.Store
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
