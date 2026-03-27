import { Method } from 'mppx'
import { z } from 'zod/mini'

/**
 * Stellar charge intent for one-time SAC token transfers.
 *
 * Supports two credential flows:
 * - `type: "transaction"` — **server-broadcast** (pull mode):
 *   Client signs a Soroban SAC `transfer` invocation and sends the
 *   serialised XDR as `payload.transaction`. The server broadcasts it.
 * - `type: "hash"` — **client-broadcast** (push mode):
 *   Client broadcasts itself and sends the transaction hash.
 *   The server looks it up on-chain for verification.
 *
 * @see https://stellar.org
 */
export const charge = Method.from({
  name: 'stellar',
  intent: 'charge',
  schema: {
    credential: {
      payload: z.discriminatedUnion('type', [
        /** Push mode: client broadcasts and sends the tx hash. */
        z.object({ hash: z.string(), type: z.literal('hash') }),
        /** Pull mode: client sends signed XDR as `payload.transaction`, server broadcasts. */
        z.object({ transaction: z.string(), type: z.literal('transaction') }),
      ]),
    },
    request: z.object({
      /** Payment amount in base units (stroops). */
      amount: z.string(),
      /** SAC contract address (C...) for the token to transfer. */
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
          /** Whether the server will sponsor transaction fees. */
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
