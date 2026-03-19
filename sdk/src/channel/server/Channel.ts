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
import { toBaseUnits } from '../../Methods.js'
import { channel as ChannelMethod } from '../Methods.js'
import { getChannelState, type ChannelState } from './State.js'

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
    checkOnChainState = false,
    closeKey: closeKeyParam,
    commitmentKey: commitmentKeyParam,
    decimals = DEFAULT_DECIMALS,
    network = 'testnet',
    onDisputeDetected,
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

  // Parse the optional close signer key
  const closeKeypair = (() => {
    if (!closeKeyParam) return undefined
    if (typeof closeKeyParam === 'string') {
      return Keypair.fromSecret(closeKeyParam)
    }
    return closeKeyParam
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

      // Lazy on-chain dispute detection: if enabled, check whether
      // close_start has been called on-chain. This mirrors Tempo's
      // close_requested_at guard — each incoming voucher refreshes
      // our view of the channel without requiring a background poller.
      if (checkOnChainState) {
        if (!sourceAccount) {
          throw new Error(
            'checkOnChainState requires sourceAccount to be set. ' +
            'Provide a funded Stellar account address (G...) to use for on-chain simulations.',
          )
        }
        try {
          const state = await getChannelState({
            channel: channelAddress,
            network,
            rpcUrl,
            sourceAccount,
          })

          // Cache the on-chain state for the caller
          if (store) {
            await store.put(
              `stellar:channel:state:${channelAddress}`,
              {
                balance: state.balance.toString(),
                closeEffectiveAtLedger: state.closeEffectiveAtLedger,
                currentLedger: state.currentLedger,
                queriedAt: new Date().toISOString(),
              },
            )
          }

          if (state.closeEffectiveAtLedger != null) {
            onDisputeDetected?.(state)

            if (state.currentLedger >= state.closeEffectiveAtLedger) {
              throw new ChannelVerificationError(
                'Channel is closed: close effective ledger has been reached.',
                {
                  closeEffectiveAtLedger: String(state.closeEffectiveAtLedger),
                  currentLedger: String(state.currentLedger),
                },
              )
            }
          }
        } catch (error) {
          // Re-throw ChannelVerificationError (channel closed)
          if (error instanceof ChannelVerificationError) throw error
          // Silently continue if on-chain check fails (network issue).
          // The verify logic below still protects against invalid credentials.
        }
      }

      // Validate hex signature format
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

      // The commitment must cover the requested amount
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

      // Verify: call prepare_commitment on the channel contract to
      // reconstruct the expected commitment bytes, then verify the
      // ed25519 signature.
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

      // Dispatch on action
      const action = payload.action ?? 'voucher'

      if (action === 'close') {
        if (!closeKeypair) {
          throw new ChannelVerificationError(
            'Close action requires a closeKey to be configured.',
            {},
          )
        }

        // Submit the close transaction on-chain
        const closeOp = contract.call(
          'close',
          nativeToScVal(commitmentAmount, { type: 'i128' }),
          nativeToScVal(Buffer.from(signatureBytes), { type: 'bytes' }),
        )

        const closeAccount = await server.getAccount(closeKeypair.publicKey())
        const closeTx = new TransactionBuilder(closeAccount, {
          fee: '100',
          networkPassphrase,
        })
          .addOperation(closeOp)
          .setTimeout(180)
          .build()

        const prepared = await server.prepareTransaction(closeTx)
        prepared.sign(closeKeypair)

        const sendResult = await server.sendTransaction(prepared)

        const MAX_POLL_ATTEMPTS = 60
        let txResult = await server.getTransaction(sendResult.hash)
        let attempts = 0
        while (txResult.status === 'NOT_FOUND') {
          if (++attempts >= MAX_POLL_ATTEMPTS) {
            throw new ChannelVerificationError(
              `Close transaction not found after ${MAX_POLL_ATTEMPTS} attempts.`,
              { hash: sendResult.hash },
            )
          }
          await new Promise((r) => setTimeout(r, 1000))
          txResult = await server.getTransaction(sendResult.hash)
        }

        if (txResult.status !== 'SUCCESS') {
          throw new ChannelVerificationError(
            `Close transaction failed: ${txResult.status}`,
            { hash: sendResult.hash, status: txResult.status },
          )
        }

        // Mark channel as finalized in store
        if (store) {
          await store.put(`stellar:channel:finalized:${channelAddress}`, {
            finalizedAt: new Date().toISOString(),
            txHash: sendResult.hash,
            amount: commitmentAmount.toString(),
          })
        }

        return Receipt.from({
          method: 'stellar',
          reference: sendResult.hash,
          status: 'success',
          timestamp: new Date().toISOString(),
        })
      }

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
     * When true, each verify call lazily reads on-chain state to detect
     * if `close_start` has been called (dispute detection). Requires
     * `sourceAccount` to be set — a configuration error is thrown if
     * `sourceAccount` is missing when this is enabled. @default false
     */
    checkOnChainState?: boolean
    /**
     * Keypair for signing close transactions. Required when handling
     * close credential actions. Accepts a Stellar secret key string (S...)
     * or a Keypair instance.
     */
    closeKey?: string | Keypair
    /**
     * Ed25519 public key for verifying commitment signatures.
     * Accepts a Stellar public key string (G...) or a Keypair instance.
     */
    commitmentKey: string | Keypair
    /** Number of decimal places for amount conversion. @default 7 */
    decimals?: number
    /** Stellar network. @default 'testnet' */
    network?: NetworkId
    /**
     * Called when a dispute is detected on-chain (close_start has been called).
     * Use this to trigger a close response before the waiting period elapses.
     */
    onDisputeDetected?: (state: ChannelState) => void
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
