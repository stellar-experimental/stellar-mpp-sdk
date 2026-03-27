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
import { toBaseUnits } from '../../shared/units.js'
import { resolveKeypair } from '../../shared/keypairs.js'
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
    network = 'testnet',
    onDisputeDetected,
    rpcUrl,
    signer: signerParam,
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

    // NM-001: Reject credentials once the channel has been finalized (closed on-chain).
    // Applied to all actions including 'open'.
    if (store) {
      const finalized = await store.get(`stellar:channel:finalized:${channelAddress}`)
      if (finalized) {
        throw new ChannelVerificationError(
          'Channel has been finalized. No further credentials accepted.',
          { channel: channelAddress },
        )
      }
    }

    // Replay protection — applied to all actions including 'open'.
    // NM-002: The verifyLock serializes calls so the get→put gap cannot
    // be exploited in a single-process deployment. Multi-process
    // deployments MUST use a store with atomic put-if-absent semantics.
    if (store) {
      const replayKey = `stellar:challenge:${challenge.id}`
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

    // NM-001 (voucher/close): finalized and replay checks are now applied
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
            throw new ChannelVerificationError(
              'Channel is closed: close effective ledger has been reached.',
              {
                closeEffectiveAtLedger: String(state.closeEffectiveAtLedger),
                currentLedger: String(state.currentLedger),
              },
            )
          }
        }

        // NM-003: Reject commitments that exceed the channel's on-chain balance.
        if (commitmentAmount > state.balance) {
          throw new ChannelVerificationError(
            `Commitment ${commitmentAmount} exceeds channel balance ${state.balance}.`,
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
        throw new ChannelVerificationError(
          'On-chain state check failed. Cannot verify channel status.',
          { error: error instanceof Error ? error.message : String(error) },
        )
      }
    }

    // Validate hex signature format
    if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length % 2 !== 0) {
      throw new ChannelVerificationError('Invalid signature: not a valid hex string.', {
        signature: signatureHex,
      })
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

    // Reject zero or negative requested amounts
    const requestedAmount = BigInt(challengeRequest.amount)
    if (requestedAmount <= 0n) {
      throw new ChannelVerificationError('Requested amount must be positive.', {
        requestedAmount: requestedAmount.toString(),
      })
    }

    // The new cumulative must be strictly greater than previous cumulative
    if (commitmentAmount <= previousCumulative) {
      throw new ChannelVerificationError(
        `Commitment amount ${commitmentAmount} must be greater than previous cumulative ${previousCumulative}.`,
        {
          commitmentAmount: commitmentAmount.toString(),
          previousCumulative: previousCumulative.toString(),
        },
      )
    }

    // The commitment must cover the requested amount
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

    const account = await server.getAccount(sourceAccount ?? commitmentKeypair.publicKey())
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
          error: 'error' in simResult ? String(simResult.error) : 'unknown',
        },
      )
    }

    const returnValue = simResult.result?.retval
    if (!returnValue) {
      throw new ChannelVerificationError('prepare_commitment returned no value.', {})
    }

    const commitmentBytes = returnValue.bytes()

    // Verify the ed25519 signature
    const valid = commitmentKeypair.verify(Buffer.from(commitmentBytes), signatureBytes)

    if (!valid) {
      throw new ChannelVerificationError('Commitment signature verification failed.', {
        amount: commitmentAmount.toString(),
        channel: channelAddress,
      })
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
        throw new ChannelVerificationError('Close action requires a signer to be configured.', {})
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
        const MAX_FEE_BUMP = 10_000_000
        const bumpFee = Math.min(Number(prepared.fee) * 10, MAX_FEE_BUMP)
        txToSubmit = TransactionBuilder.buildFeeBumpTransaction(
          feeBumpKeypair,
          bumpFee.toString(),
          prepared,
          networkPassphrase,
        )
        txToSubmit.sign(feeBumpKeypair)
      }

      const sendResult = await server.sendTransaction(txToSubmit)

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
        throw new ChannelVerificationError(`Close transaction failed: ${txResult.status}`, {
          hash: sendResult.hash,
          status: txResult.status,
        })
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
      throw new ChannelVerificationError('Open action requires a signed transaction XDR.', {})
    }

    // Validate signature format
    if (!/^[0-9a-f]+$/i.test(signatureHex) || signatureHex.length !== 128) {
      throw new ChannelVerificationError('Invalid commitment signature for open action.', {
        length: String(signatureHex?.length ?? 0),
      })
    }

    const commitmentAmount = BigInt(amount)
    const signatureBytes = Buffer.from(signatureHex, 'hex')

    // Enforce amount invariants: both the commitment and the requested amount
    // must be positive, and the commitment must cover the requested amount.
    const requestedAmount = BigInt(challenge.request.amount)
    if (requestedAmount <= 0n) {
      throw new ChannelVerificationError('Open action requires a positive requested amount.', {
        requestedAmount: requestedAmount.toString(),
      })
    }
    if (commitmentAmount <= 0n) {
      throw new ChannelVerificationError('Open action requires a positive commitment amount.', {
        commitmentAmount: commitmentAmount.toString(),
      })
    }
    if (commitmentAmount < requestedAmount) {
      throw new ChannelVerificationError(
        'Commitment amount does not cover requested amount for open action.',
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
          'Channel is already open. Cannot replay an open credential.',
          { channel: channelAddress },
        )
      }
    }

    // Verify the initial commitment signature via prepare_commitment simulation
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
      .setTimeout(30)
      .build()

    const simResult = await server.simulateTransaction(simTx)

    if (!rpc.Api.isSimulationSuccess(simResult)) {
      throw new ChannelVerificationError(
        'Failed to simulate prepare_commitment for open verification.',
        {
          error: 'error' in simResult ? String(simResult.error) : 'unknown',
        },
      )
    }

    const returnValue = simResult.result?.retval
    if (!returnValue) {
      throw new ChannelVerificationError('prepare_commitment returned no value during open.', {})
    }

    const commitmentBytes = returnValue.bytes()

    const valid = commitmentKeypair.verify(Buffer.from(commitmentBytes), signatureBytes)

    if (!valid) {
      throw new ChannelVerificationError('Initial commitment signature verification failed.', {
        amount: commitmentAmount.toString(),
        channel: channelAddress,
      })
    }

    // Parse and broadcast the open transaction
    const { TransactionBuilder: TxBuilder } = await import('@stellar/stellar-sdk')

    let openTx: ReturnType<typeof TxBuilder.fromXDR>
    try {
      openTx = TxBuilder.fromXDR(txXdr, networkPassphrase)
    } catch (err) {
      throw new ChannelVerificationError('Invalid open transaction XDR.', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    let txToSubmit = openTx
    if (feeBumpKeypair) {
      const innerTx =
        openTx instanceof FeeBumpTransaction ? openTx.innerTransaction : (openTx as Transaction)
      const MAX_FEE_BUMP = 10_000_000
      const bumpFee = Math.min(Number(innerTx.fee) * 10, MAX_FEE_BUMP)
      txToSubmit = TransactionBuilder.buildFeeBumpTransaction(
        feeBumpKeypair,
        bumpFee.toString(),
        innerTx,
        networkPassphrase,
      )
      ;(txToSubmit as FeeBumpTransaction).sign(feeBumpKeypair)
    }
    const sendResult = await server.sendTransaction(txToSubmit)

    const MAX_POLL_ATTEMPTS = 60
    let txResult = await server.getTransaction(sendResult.hash)
    let attempts = 0
    while (txResult.status === 'NOT_FOUND') {
      if (++attempts >= MAX_POLL_ATTEMPTS) {
        throw new ChannelVerificationError(
          `Open transaction not found after ${MAX_POLL_ATTEMPTS} attempts.`,
          { hash: sendResult.hash },
        )
      }
      await new Promise((r) => setTimeout(r, 1000))
      txResult = await server.getTransaction(sendResult.hash)
    }

    if (txResult.status !== 'SUCCESS') {
      throw new ChannelVerificationError(`Open transaction failed: ${txResult.status}`, {
        hash: sendResult.hash,
        status: txResult.status,
      })
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
}): Promise<string> {
  const {
    channel: channelAddress,
    amount,
    signature,
    signer,
    feeBumpSigner,
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
    const MAX_FEE_BUMP = 10_000_000
    const bumpFee = Math.min(Number(prepared.fee) * 10, MAX_FEE_BUMP)
    txToSubmit = TransactionBuilder.buildFeeBumpTransaction(
      feeBumpSigner,
      bumpFee.toString(),
      prepared,
      networkPassphrase,
    )
    txToSubmit.sign(feeBumpSigner)
  }

  const result = await server.sendTransaction(txToSubmit)

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
    throw new ChannelVerificationError(`Close transaction failed: ${txResult.status}`, {
      hash: result.hash,
      status: txResult.status,
    })
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
