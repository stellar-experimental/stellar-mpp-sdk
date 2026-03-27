import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  xdr as StellarXdr,
} from '@stellar/stellar-sdk'
import { Credential, Method } from 'mppx'
import { z } from 'zod/mini'
import {
  ALL_ZEROS,
  CAIP2_TO_NETWORK,
  DEFAULT_DECIMALS,
  DEFAULT_LEDGER_CLOSE_TIME,
  DEFAULT_TIMEOUT,
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../../constants.js'
import * as Methods from '../Methods.js'
import { fromBaseUnits } from '../Methods.js'
import { StellarMppError } from '../../shared/errors.js'
import { resolveKeypair } from '../../shared/keypairs.js'
import { pollTransaction } from '../../shared/poll.js'
import {
  DEFAULT_POLL_MAX_ATTEMPTS,
  DEFAULT_POLL_DELAY_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_SIMULATION_TIMEOUT_MS,
} from '../../shared/defaults.js'

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
    decimals = DEFAULT_DECIMALS,
    keypair: keypairParam,
    mode: defaultMode = 'pull',
    onProgress,
    pollDelayMs = DEFAULT_POLL_DELAY_MS,
    pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    rpcUrl,
    secretKey,
    simulationTimeoutMs: _simulationTimeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS,
    timeout = DEFAULT_TIMEOUT,
  } = parameters

  if (!keypairParam && !secretKey) {
    throw new StellarMppError('Either keypair or secretKey must be provided.')
  }

  const keypair = keypairParam ?? resolveKeypair(secretKey!)

  return Method.toClient(Methods.charge, {
    context: z.object({
      mode: z.optional(z.enum(['push', 'pull'])),
    }),
    async createCredential({ challenge, context }) {
      const { request } = challenge
      const { amount, currency, recipient } = request

      const caip2Network = request.methodDetails?.network ?? 'stellar:testnet'
      const network: NetworkId = CAIP2_TO_NETWORK[caip2Network] ?? 'testnet'

      onProgress?.({
        type: 'challenge',
        recipient,
        amount: fromBaseUnits(amount, decimals),
        currency,
      })

      const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
      const networkPassphrase = NETWORK_PASSPHRASE[network]
      const server = new rpc.Server(resolvedRpcUrl)

      // Build SAC `transfer(from, to, amount)` invocation
      const contract = new Contract(currency)
      const stellarAmount = BigInt(amount)

      const effectiveMode = context?.mode ?? defaultMode
      const isServerSponsored = request.methodDetails?.feePayer === true

      if (isServerSponsored && effectiveMode === 'push') {
        throw new StellarMppError(
          'Push mode is not supported for server-sponsored transactions. ' +
            "The server must submit sponsored transactions. Use mode: 'pull' (default).",
        )
      }

      // Gap #4: Derive ledger expiration from challenge.expires instead of timeout
      const expiresTimestamp: number | undefined = challenge.expires
        ? Math.floor(new Date(challenge.expires).getTime() / 1000)
        : undefined

      if (isServerSponsored) {
        // ── Spec-compliant sponsored path ──────────────────────────────────
        // Client uses an all-zeros source account so the server can swap in
        // its own fee-payer account when rebuilding the transaction.
        const placeholderSource = new Account(ALL_ZEROS, '0')

        const transferOp = contract.call(
          'transfer',
          new Address(keypair.publicKey()).toScVal(),
          new Address(recipient).toScVal(),
          nativeToScVal(stellarAmount, { type: 'i128' }),
        )

        const sponsoredBuilder = new TransactionBuilder(placeholderSource, {
          fee: BASE_FEE,
          networkPassphrase,
        }).addOperation(transferOp)

        // Gap #5: Set timeBounds.maxTime to expires timestamp
        if (expiresTimestamp) {
          sponsoredBuilder.setTimeout(0)
          ;(sponsoredBuilder as any).timeBounds = {
            minTime: 0,
            maxTime: expiresTimestamp,
          }
        } else {
          sponsoredBuilder.setTimeout(timeout)
        }

        const unsignedTx = sponsoredBuilder.build()
        const prepared = await server.prepareTransaction(unsignedTx)

        // Gap #4: Derive auth-entry expiry from challenge.expires
        const latestLedger = await server.getLatestLedger()
        let validUntilLedger: number
        if (expiresTimestamp) {
          const nowSecs = Math.floor(Date.now() / 1000)
          const secsUntilExpiry = Math.max(expiresTimestamp - nowSecs, 0)
          validUntilLedger =
            latestLedger.sequence + Math.ceil(secsUntilExpiry / DEFAULT_LEDGER_CLOSE_TIME)
        } else {
          validUntilLedger = latestLedger.sequence + Math.ceil(timeout / 5) + 10
        }

        onProgress?.({ type: 'signing' })

        // Sign only the Soroban authorization entries — do NOT sign the
        // transaction envelope (the server will do that after rebuilding).
        const envelope = prepared.toEnvelope().v1()
        for (const op of envelope.tx().operations()) {
          const body = op.body()
          if (body.switch().value !== StellarXdr.OperationType.invokeHostFunction().value) {
            continue
          }
          const authEntries = body.invokeHostFunctionOp().auth()
          for (let i = 0; i < authEntries.length; i++) {
            const entry = authEntries[i]
            if (
              entry.credentials().switch().value ===
              StellarXdr.SorobanCredentialsType.sorobanCredentialsAddress().value
            ) {
              authEntries[i] = await authorizeEntry(
                entry,
                keypair,
                validUntilLedger,
                networkPassphrase,
              )
            }
          }
        }

        const signedXdr = prepared.toEnvelope().toXDR('base64')
        onProgress?.({ type: 'signed', transaction: signedXdr })

        // Gap #14: Add DID-PKH source field
        const caip2Component = caip2Network.split(':')[1] ?? 'testnet'
        const source = `did:pkh:stellar:${caip2Component}:${keypair.publicKey()}`

        return Credential.serialize({
          challenge,
          payload: { type: 'transaction' as const, transaction: signedXdr, source },
        })
      }

      // ── Standard (unsponsored) path ────────────────────────────────────────
      // Client builds and signs the full transaction; server submits as-is
      // (or wraps it in a fee bump if it has a configured fee payer).
      const sourceAccount = await server.getAccount(keypair.publicKey())

      const transferOp = contract.call(
        'transfer',
        new Address(keypair.publicKey()).toScVal(),
        new Address(recipient).toScVal(),
        nativeToScVal(stellarAmount, { type: 'i128' }),
      )

      const builder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      }).addOperation(transferOp)

      // Gap #5: Set timeBounds.maxTime to expires timestamp for unsponsored path
      if (expiresTimestamp) {
        builder.setTimeout(0)
        ;(builder as any).timeBounds = {
          minTime: 0,
          maxTime: expiresTimestamp,
        }
      } else {
        builder.setTimeout(timeout)
      }

      const transaction = builder.build()

      // Simulate to attach Soroban resource data
      const prepared = await server.prepareTransaction(transaction)

      onProgress?.({ type: 'signing' })
      prepared.sign(keypair)

      const signedXdr = prepared.toXDR()
      onProgress?.({ type: 'signed', transaction: signedXdr })

      // Gap #14: Add DID-PKH source field
      const caip2Component = caip2Network.split(':')[1] ?? 'testnet'
      const source = `did:pkh:stellar:${caip2Component}:${keypair.publicKey()}`

      if (effectiveMode === 'push') {
        // Client broadcasts
        onProgress?.({ type: 'paying' })
        const result = await server.sendTransaction(prepared)

        // Poll until confirmed
        onProgress?.({ type: 'confirming', hash: result.hash })
        await pollTransaction(server, result.hash, {
          maxAttempts: pollMaxAttempts,
          delayMs: pollDelayMs,
          timeoutMs: pollTimeoutMs,
        })

        onProgress?.({ type: 'paid', hash: result.hash })

        return Credential.serialize({
          challenge,
          payload: { type: 'hash' as const, hash: result.hash, source },
        })
      }

      // Pull mode: send signed XDR for server to broadcast
      return Credential.serialize({
        challenge,
        payload: { type: 'transaction' as const, transaction: signedXdr, source },
      })
    },
  })
}

export declare namespace charge {
  type ProgressEvent =
    | { type: 'challenge'; recipient: string; amount: string; currency: string }
    | { type: 'signing' }
    | { type: 'signed'; transaction: string }
    | { type: 'paying' }
    | { type: 'confirming'; hash: string }
    | { type: 'paid'; hash: string }

  type Parameters = {
    /** Stellar secret key (S...). Provide either this or `keypair`. */
    secretKey?: string
    /** Stellar Keypair instance. Provide either this or `secretKey`. */
    keypair?: Keypair
    /** Number of decimal places for the token. @default 7 */
    decimals?: number
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
    /** Maximum polling attempts. @default 30 */
    pollMaxAttempts?: number
    /** Delay between poll attempts in ms. @default 1_000 */
    pollDelayMs?: number
    /** Overall poll timeout in ms. @default 30_000 */
    pollTimeoutMs?: number
    /** Simulation timeout in ms. @default 10_000 */
    simulationTimeoutMs?: number
  }
}
