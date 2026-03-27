import {
  Contract,
  FeeBumpTransaction,
  Keypair,
  Transaction,
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
import {
  DEFAULT_MAX_FEE_BUMP_STROOPS,
  DEFAULT_POLL_DELAY_MS,
  DEFAULT_POLL_MAX_ATTEMPTS,
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_SIMULATION_TIMEOUT_MS,
} from '../../shared/defaults.js'
import { ChannelVerificationError } from '../../shared/errors.js'
import { wrapFeeBump } from '../../shared/fee-bump.js'
import { resolveKeypair } from '../../shared/keypairs.js'
import { noopLogger, type Logger } from '../../shared/logger.js'
import { pollTransaction } from '../../shared/poll.js'
import { toBaseUnits } from '../../shared/units.js'
import { validateHexSignature } from '../../shared/validation.js'
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
    commitmentKey: commitmentKeyParam,
    decimals = DEFAULT_DECIMALS,
    feeBumpSigner: feeBumpSignerParam,
    maxFeeBumpStroops = DEFAULT_MAX_FEE_BUMP_STROOPS,
    network = 'testnet',
    onDisputeDetected,
    pollDelayMs = DEFAULT_POLL_DELAY_MS,
    pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    rpcUrl,
    simulationTimeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS,
    signer: signerParam,
    sourceAccount,
    store,
    logger = noopLogger,
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

  const signerKeypair = signerParam ? resolveKeypair(signerParam) : undefined
  const feeBumpKeypair = feeBumpSignerParam ? resolveKeypair(feeBumpSignerParam) : undefined

  // Track cumulative amounts per channel in the store
  const cumulativeKey = `stellar:channel:cumulative:${channelAddress}`

  // Serialize verify operations to prevent concurrent double-acceptance.
  // Without a transactional store, two concurrent verify calls could both
  // read the same cumulative amount, both pass, and only one write wins.
  let verifyLock: Promise<unknown> = Promise.resolve()

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
      // Serialize through the lock to prevent concurrent double-acceptance
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

    const payload = credential.payload
    const action = payload.action ?? 'voucher'

    // NM-001: Reject credentials once the channel has been closed on-chain.
    // Applied to all actions including 'open'.
    if (store) {
      const closed = await store.get(`stellar:channel:closed:${channelAddress}`)
      if (closed) {
        logger.warn('[stellar:channel] Rejecting credential — channel already closed', {
          channel: channelAddress,
        })
        throw new ChannelVerificationError(
          '[stellar:channel] Channel has been closed. No further credentials accepted.',
          { channel: channelAddress },
        )
      }
    }

    // Replay protection — applied to all actions including 'open'.
    // NM-002: The verifyLock serializes calls so the get→put gap cannot
    // be exploited in a single-process deployment. Multi-process
    // deployments MUST use a store with atomic put-if-absent semantics.
    if (store) {
      const replayKey = `stellar:channel:challenge:${challenge.id}`
      const existing = await store.get(replayKey)
      if (existing) {
        throw new Error('Challenge already used. Replay rejected.')
      }
      await store.put(replayKey, { usedAt: new Date().toISOString() })
    }

    // Dispatch open action to its own handler — it has completely
    // different semantics (broadcasts an on-chain tx) compared to
    // voucher/close which operate on existing channels.
    if (action === 'open') {
      return doVerifyOpen(credential)
    }

    // NM-001 (voucher/close): closed and replay checks are now applied
    // earlier in doVerify() for all actions including 'open'.

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

        logger.debug('[stellar:channel] On-chain state check', {
          balance: state.balance.toString(),
          closeAt: state.closeEffectiveAtLedger,
        })

        // Cache the on-chain state for the caller
        if (store) {
          await store.put(`stellar:channel:state:${channelAddress}`, {
            balance: state.balance.toString(),
            closeEffectiveAtLedger: state.closeEffectiveAtLedger,
            currentLedger: state.currentLedger,
            queriedAt: new Date().toISOString(),
          })
        }

        if (state.closeEffectiveAtLedger != null) {
          onDisputeDetected?.(state)

          if (state.currentLedger >= state.closeEffectiveAtLedger) {
            logger.warn('[stellar:channel] Channel is closed — effective ledger reached', {
              closeEffectiveAtLedger: state.closeEffectiveAtLedger,
              currentLedger: state.currentLedger,
            })
            throw new ChannelVerificationError(
              '[stellar:channel] Channel is closed: close effective ledger has been reached.',
              {
                closeEffectiveAtLedger: String(state.closeEffectiveAtLedger),
                currentLedger: String(state.currentLedger),
              },
            )
          }
        }

        // NM-003: Reject commitments that exceed the channel's on-chain balance.
        if (commitmentAmount > state.balance) {
          logger.warn('[stellar:channel] Commitment exceeds channel balance', {
            commitmentAmount: commitmentAmount.toString(),
            balance: state.balance.toString(),
          })
          throw new ChannelVerificationError(
            `[stellar:channel] Commitment ${commitmentAmount} exceeds channel balance ${state.balance}.`,
            {
              commitmentAmount: commitmentAmount.toString(),
              balance: state.balance.toString(),
            },
          )
        }
      } catch (error) {
        // Re-throw ChannelVerificationError (channel closed / over-balance)
        if (error instanceof ChannelVerificationError) throw error
        // NM-005: Fail closed — reject the voucher when the on-chain
        // check cannot be completed rather than silently skipping it.
        logger.warn('[stellar:channel] On-chain state check failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        throw new ChannelVerificationError(
          '[stellar:channel] On-chain state check failed. Cannot verify channel status.',
          { error: error instanceof Error ? error.message : String(error) },
        )
      }
    }

    // Validate hex signature format
    try {
      validateHexSignature(signatureHex)
    } catch (err) {
      logger.warn('[stellar:channel] Invalid signature format', {
        signature: signatureHex,
        length: signatureHex?.length,
      })
      throw new ChannelVerificationError(
        `[stellar:channel] ${err instanceof Error ? err.message : 'Invalid signature'}`,
        { signature: signatureHex, length: String(signatureHex?.length ?? 0) },
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

    // Reject zero or negative requested amounts
    const requestedAmount = BigInt(challengeRequest.amount)
    if (requestedAmount <= 0n) {
      logger.warn('[stellar:channel] Non-positive requested amount', {
        requestedAmount: requestedAmount.toString(),
      })
      throw new ChannelVerificationError('[stellar:channel] Requested amount must be positive.', {
        requestedAmount: requestedAmount.toString(),
      })
    }

    // The new cumulative must be strictly greater than previous cumulative
    if (commitmentAmount <= previousCumulative) {
      logger.warn('[stellar:channel] Commitment not greater than previous cumulative', {
        commitmentAmount: commitmentAmount.toString(),
        previousCumulative: previousCumulative.toString(),
      })
      throw new ChannelVerificationError(
        `[stellar:channel] Commitment amount ${commitmentAmount} must be greater than previous cumulative ${previousCumulative}.`,
        {
          commitmentAmount: commitmentAmount.toString(),
          previousCumulative: previousCumulative.toString(),
        },
      )
    }

    // The commitment must cover the requested amount
    if (commitmentAmount < previousCumulative + requestedAmount) {
      logger.warn('[stellar:channel] Commitment does not cover requested amount', {
        commitmentAmount: commitmentAmount.toString(),
        requestedAmount: requestedAmount.toString(),
        previousCumulative: previousCumulative.toString(),
      })
      throw new ChannelVerificationError(
        `[stellar:channel] Commitment amount ${commitmentAmount} does not cover the requested amount ${requestedAmount} (previous cumulative: ${previousCumulative}).`,
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
    logger.debug('[stellar:channel] Verifying commitment signature...')
    const contract = new Contract(channelAddress)
    const call = contract.call(
      'prepare_commitment',
      nativeToScVal(commitmentAmount, { type: 'i128' }),
    )

    const account = await server.getAccount(sourceAccount ?? commitmentKeypair.publicKey())
    const simTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(call)
      .setTimeout(simulationTimeoutMs / 1000)
      .build()

    const simResult = await server.simulateTransaction(simTx)

    if (!rpc.Api.isSimulationSuccess(simResult)) {
      logger.warn('[stellar:channel] prepare_commitment simulation failed')
      throw new ChannelVerificationError(
        '[stellar:channel] Failed to simulate prepare_commitment for verification.',
        {
          error: 'error' in simResult ? String(simResult.error) : 'unknown',
        },
      )
    }

    const returnValue = simResult.result?.retval
    if (!returnValue) {
      throw new ChannelVerificationError(
        '[stellar:channel] prepare_commitment returned no value.',
        {},
      )
    }

    const commitmentBytes = returnValue.bytes()

    // Verify the ed25519 signature
    const valid = commitmentKeypair.verify(Buffer.from(commitmentBytes), signatureBytes)

    if (!valid) {
      logger.warn('[stellar:channel] Commitment signature verification failed', {
        amount: commitmentAmount.toString(),
        channel: channelAddress,
      })
      throw new ChannelVerificationError(
        '[stellar:channel] Commitment signature verification failed.',
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
    if (action === 'close') {
      if (!signerKeypair) {
        throw new ChannelVerificationError(
          '[stellar:channel] Close action requires a signer to be configured.',
          {},
        )
      }

      // Submit the close transaction on-chain
      const closeOp = contract.call(
        'close',
        nativeToScVal(commitmentAmount, { type: 'i128' }),
        nativeToScVal(Buffer.from(signatureBytes), { type: 'bytes' }),
      )

      const closeAccount = await server.getAccount(signerKeypair.publicKey())
      const closeTx = new TransactionBuilder(closeAccount, {
        fee: '100',
        networkPassphrase,
      })
        .addOperation(closeOp)
        .setTimeout(180)
        .build()

      const prepared = await server.prepareTransaction(closeTx)
      prepared.sign(signerKeypair)

      let txToSubmit: Transaction | FeeBumpTransaction = prepared
      if (feeBumpKeypair) {
        txToSubmit = wrapFeeBump(prepared, feeBumpKeypair, {
          networkPassphrase,
          maxFeeStroops: maxFeeBumpStroops,
        })
      }

      logger.debug('[stellar:channel] Broadcasting close tx...')
      const sendResult = await server.sendTransaction(txToSubmit)

      const txResult = await pollTransaction(server, sendResult.hash, {
        maxAttempts: pollMaxAttempts,
        delayMs: pollDelayMs,
        timeoutMs: pollTimeoutMs,
      })

      if (txResult.status !== 'SUCCESS') {
        throw new ChannelVerificationError(
          `[stellar:channel] Close transaction failed: ${txResult.status}`,
          {
            hash: sendResult.hash,
            status: txResult.status,
          },
        )
      }

      // Mark channel as closed in store
      logger.debug('[stellar:channel] Channel closed, marking in store')
      if (store) {
        await store.put(`stellar:channel:closed:${channelAddress}`, {
          closedAt: new Date().toISOString(),
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
  }

  /**
   * Verify an "open" credential: the client sends a signed channel-open
   * transaction XDR along with an initial commitment signature. The server
   * broadcasts the transaction, waits for confirmation, then initialises
   * the cumulative amount in the store.
   */
  async function doVerifyOpen(credential: any) {
    const { challenge } = credential
    const payload = credential.payload
    const { transaction: txXdr, amount, signature: signatureHex } = payload

    if (!txXdr || typeof txXdr !== 'string') {
      throw new ChannelVerificationError(
        '[stellar:channel] Open action requires a signed transaction XDR.',
        {},
      )
    }

    // Validate signature format
    try {
      validateHexSignature(signatureHex)
    } catch {
      logger.warn('[stellar:channel] Invalid commitment signature for open action', {
        length: signatureHex?.length,
      })
      throw new ChannelVerificationError(
        '[stellar:channel] Invalid commitment signature for open action.',
        {
          length: String(signatureHex?.length ?? 0),
        },
      )
    }

    const commitmentAmount = BigInt(amount)
    const signatureBytes = Buffer.from(signatureHex, 'hex')

    // Enforce amount invariants: both the commitment and the requested amount
    // must be positive, and the commitment must cover the requested amount.
    const requestedAmount = BigInt(challenge.request.amount)
    if (requestedAmount <= 0n) {
      throw new ChannelVerificationError(
        '[stellar:channel] Open action requires a positive requested amount.',
        {
          requestedAmount: requestedAmount.toString(),
        },
      )
    }
    if (commitmentAmount <= 0n) {
      throw new ChannelVerificationError(
        '[stellar:channel] Open action requires a positive commitment amount.',
        {
          commitmentAmount: commitmentAmount.toString(),
        },
      )
    }
    if (commitmentAmount < requestedAmount) {
      throw new ChannelVerificationError(
        '[stellar:channel] Commitment amount does not cover requested amount for open action.',
        {
          commitmentAmount: commitmentAmount.toString(),
          requestedAmount: requestedAmount.toString(),
        },
      )
    }

    // Reject if the channel is already opened (cumulativeKey already set).
    if (store) {
      const existing = await store.get(cumulativeKey)
      if (existing) {
        throw new ChannelVerificationError(
          '[stellar:channel] Channel is already open. Cannot replay an open credential.',
          { channel: channelAddress },
        )
      }
    }

    // Verify the initial commitment signature via prepare_commitment simulation
    logger.debug('[stellar:channel] Verifying commitment signature...')
    const contract = new Contract(channelAddress)
    const call = contract.call(
      'prepare_commitment',
      nativeToScVal(commitmentAmount, { type: 'i128' }),
    )

    const account = await server.getAccount(sourceAccount ?? commitmentKeypair.publicKey())
    const simTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(call)
      .setTimeout(simulationTimeoutMs / 1000)
      .build()

    const simResult = await server.simulateTransaction(simTx)

    if (!rpc.Api.isSimulationSuccess(simResult)) {
      throw new ChannelVerificationError(
        '[stellar:channel] Failed to simulate prepare_commitment for open verification.',
        {
          error: 'error' in simResult ? String(simResult.error) : 'unknown',
        },
      )
    }

    const returnValue = simResult.result?.retval
    if (!returnValue) {
      throw new ChannelVerificationError(
        '[stellar:channel] prepare_commitment returned no value during open.',
        {},
      )
    }

    const commitmentBytes = returnValue.bytes()

    const valid = commitmentKeypair.verify(Buffer.from(commitmentBytes), signatureBytes)

    if (!valid) {
      logger.warn('[stellar:channel] Initial commitment signature verification failed', {
        amount: commitmentAmount.toString(),
        channel: channelAddress,
      })
      throw new ChannelVerificationError(
        '[stellar:channel] Initial commitment signature verification failed.',
        {
          amount: commitmentAmount.toString(),
          channel: channelAddress,
        },
      )
    }

    // Parse and broadcast the open transaction
    let openTx: ReturnType<typeof TransactionBuilder.fromXDR>
    try {
      openTx = TransactionBuilder.fromXDR(txXdr, networkPassphrase)
    } catch (err) {
      throw new ChannelVerificationError('[stellar:channel] Invalid open transaction XDR.', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    let txToSubmit = openTx
    if (feeBumpKeypair) {
      const innerTx =
        openTx instanceof FeeBumpTransaction ? openTx.innerTransaction : (openTx as Transaction)
      txToSubmit = wrapFeeBump(innerTx, feeBumpKeypair, {
        networkPassphrase,
        maxFeeStroops: maxFeeBumpStroops,
      })
    }
    const sendResult = await server.sendTransaction(txToSubmit)

    const txResult = await pollTransaction(server, sendResult.hash, {
      maxAttempts: pollMaxAttempts,
      delayMs: pollDelayMs,
      timeoutMs: pollTimeoutMs,
    })

    if (txResult.status !== 'SUCCESS') {
      throw new ChannelVerificationError(
        `[stellar:channel] Open transaction failed: ${txResult.status}`,
        {
          hash: sendResult.hash,
          status: txResult.status,
        },
      )
    }

    // Initialise cumulative amount in the store
    if (store) {
      await store.put(cumulativeKey, {
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
  /** Keypair to sign the close transaction (source account). */
  signer: Keypair
  /** Optional fee bump signer. */
  feeBumpSigner?: Keypair
  /** Network identifier. */
  network?: NetworkId
  /** Custom RPC URL. */
  rpcUrl?: string
  /** Maximum fee bump in stroops. */
  maxFeeBumpStroops?: number
  /** Maximum poll attempts. */
  pollMaxAttempts?: number
  /** Poll delay in ms. */
  pollDelayMs?: number
  /** Poll timeout in ms. */
  pollTimeoutMs?: number
  /** Logger instance. */
  logger?: Logger
}): Promise<string> {
  const {
    channel: channelAddress,
    amount,
    signature,
    signer,
    feeBumpSigner,
    network = 'testnet',
    rpcUrl,
    maxFeeBumpStroops = DEFAULT_MAX_FEE_BUMP_STROOPS,
    pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    pollDelayMs = DEFAULT_POLL_DELAY_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    logger: log = noopLogger,
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

  const account = await server.getAccount(signer.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(closeOp)
    .setTimeout(180)
    .build()

  const prepared = await server.prepareTransaction(tx)
  prepared.sign(signer)

  let txToSubmit: Transaction | FeeBumpTransaction = prepared
  if (feeBumpSigner) {
    txToSubmit = wrapFeeBump(prepared, feeBumpSigner, {
      networkPassphrase,
      maxFeeStroops: maxFeeBumpStroops,
    })
  }

  log.debug('[stellar:channel] Broadcasting close tx...')
  const result = await server.sendTransaction(txToSubmit)

  const txResult = await pollTransaction(server, result.hash, {
    maxAttempts: pollMaxAttempts,
    delayMs: pollDelayMs,
    timeoutMs: pollTimeoutMs,
  })

  if (txResult.status !== 'SUCCESS') {
    throw new ChannelVerificationError(
      `[stellar:channel] Close transaction failed: ${txResult.status}`,
      {
        hash: result.hash,
        status: txResult.status,
      },
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
     * Keypair for signing close transactions (provides sequence number).
     * Required when handling close credential actions.
     * Accepts a Stellar secret key string (S...) or a Keypair instance.
     */
    signer?: Keypair | string
    /** Optional fee bump signer for close/open transactions. */
    feeBumpSigner?: Keypair | string
    /**
     * Ed25519 public key for verifying commitment signatures.
     * Accepts a Stellar public key string (G...) or a Keypair instance.
     */
    commitmentKey: string | Keypair
    /** Number of decimal places for amount conversion. @default 7 */
    decimals?: number
    /** Maximum fee bump in stroops. @default 10_000_000 */
    maxFeeBumpStroops?: number
    /** Stellar network. @default 'testnet' */
    network?: NetworkId
    /**
     * Called when a dispute is detected on-chain (close_start has been called).
     * Use this to trigger a close response before the waiting period elapses.
     */
    onDisputeDetected?: (state: ChannelState) => void
    /** Maximum poll attempts when waiting for transaction confirmation. @default 30 */
    pollMaxAttempts?: number
    /** Poll delay between attempts in milliseconds. @default 1000 */
    pollDelayMs?: number
    /** Poll timeout in milliseconds. @default 30_000 */
    pollTimeoutMs?: number
    /** Custom Soroban RPC URL. */
    rpcUrl?: string
    /** Simulation timeout in milliseconds. @default 10_000 */
    simulationTimeoutMs?: number
    /**
     * Funded Stellar account address (G...) used as the source for
     * read-only transaction simulations. If omitted, the commitment
     * key's public key is used, which requires it to be a funded account.
     */
    sourceAccount?: string
    /** Store for replay protection and cumulative amount tracking. */
    store?: Store.Store
    /** Logger for debug/warn messages. @default noopLogger */
    logger?: Logger
  }
}
