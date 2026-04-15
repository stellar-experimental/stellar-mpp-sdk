import { Method } from 'mppx'
import { z } from 'zod/mini'

/**
 * Stellar charge intent for one-time SEP-41 token transfers.
 *
 * Supports two credential flows:
 * - `type: "transaction"` — **server-broadcast** (pull mode):
 *   Client signs a Soroban SEP-41 `transfer` invocation and sends the
 *   serialised XDR as `payload.transaction`. The server broadcasts it.
 * - `type: "hash"` — **client-broadcast** (push mode):
 *   Client broadcasts itself and sends the transaction hash.
 *   The server looks it up on-chain for verification.
 *
 * @see https://paymentauth.org/draft-stellar-charge-00
 */
export const charge = Method.from({
  name: 'stellar',
  intent: 'charge',
  schema: {
    credential: {
      payload: z.discriminatedUnion('type', [
        /** Push mode: client broadcasts and sends the tx hash. */
        z.object({ hash: z.string().check(z.regex(/^[0-9a-f]{64}$/i)), type: z.literal('hash') }),
        /** Pull mode: client sends signed XDR as `payload.transaction`, server broadcasts. */
        z.object({ transaction: z.string(), type: z.literal('transaction') }),
      ]),
    },
    request: z.object({
      /** Payment amount in base units (stroops). */
      amount: z.string(),
      /** SEP-41 token contract address (C...) for the token to transfer. */
      currency: z.string(),
      /** Recipient Stellar public key (G...) or contract address (C...). */
      recipient: z.string(),
      /** Optional human-readable description. */
      description: z.optional(z.string()),
      /** Merchant-provided reconciliation ID (e.g. order ID, invoice number). */
      externalId: z.optional(z.string()),
      /** Method-specific details injected by the server via request(). */
      methodDetails: z.optional(
        z.object({
          /** CAIP-2 network identifier (e.g. "stellar:testnet", "stellar:pubnet"). */
          network: z.string(),
          /**
           * Whether the server sponsors the transaction.
           *
           * When `true`, the server provides the source account, sequence
           * number, and envelope signature. The client **must** use pull mode
           * (push is rejected) and build with an all-zeros placeholder source,
           * signing only the Soroban authorization entries.
           *
           * This flag is set automatically by the server when a `feePayer`
           * configuration is provided. The optional `feeBumpSigner` within
           * `feePayer` wraps the sponsored transaction in a
           * `FeeBumpTransaction` — it only applies to the sponsored path
           * since unsponsored transactions must be submitted as-is per the
           * spec.
           */
          feePayer: z.optional(z.boolean()),
        }),
      ),
    }),
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export { toBaseUnits, fromBaseUnits } from '../shared/units.js'
