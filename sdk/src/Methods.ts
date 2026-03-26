import { Method } from 'mppx'
import { z } from 'zod/mini'

/**
 * Stellar charge intent for one-time SAC token transfers.
 *
 * Supports two credential flows:
 * - `type: "transaction"` — **server-broadcast** (pull mode):
 *   Client signs a Soroban SAC `transfer` invocation and sends the
 *   serialised XDR as `payload.transaction`. The server broadcasts it.
 * - `type: "signature"` — **client-broadcast** (push mode):
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
        z.object({ hash: z.string(), type: z.literal('signature') }),
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
      /** Method-specific details injected by the server. */
      methodDetails: z.optional(
        z.object({
          /** Server-generated unique tracking ID. */
          reference: z.optional(z.string()),
          /** Stellar network identifier ("public" | "testnet"). */
          network: z.optional(z.string()),
          /** Optional memo text to attach to the transaction. */
          memo: z.optional(z.string()),
          /** Whether the server will sponsor transaction fees. */
          feePayer: z.optional(z.boolean()),
          /** Public key of the server's fee payer account. */
          feePayerKey: z.optional(z.string()),
        }),
      ),
    }),
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a human-readable amount to base units (stroops).
 *
 * @example
 * ```ts
 * toBaseUnits('0.01', 7) // '100000'
 * toBaseUnits('1', 7)    // '10000000'
 * ```
 */
export function toBaseUnits(amount: string, decimals: number): string {
  if (amount.startsWith('-')) {
    return '-' + toBaseUnits(amount.slice(1), decimals)
  }
  const [whole = '0', frac = ''] = amount.split('.')
  if (decimals === 0) return BigInt(whole).toString()
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFrac)).toString()
}

/**
 * Convert base units (stroops) back to a human-readable amount.
 *
 * @example
 * ```ts
 * fromBaseUnits('100000', 7)  // '0.0100000'
 * ```
 */
export function fromBaseUnits(baseUnits: string, decimals: number): string {
  const bi = BigInt(baseUnits)
  if (bi < 0n) {
    return '-' + fromBaseUnits((-bi).toString(), decimals)
  }
  const divisor = 10n ** BigInt(decimals)
  const whole = (bi / divisor).toString()
  const remainder = (bi % divisor).toString().padStart(decimals, '0')
  return `${whole}.${remainder}`
}
