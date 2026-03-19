import { Method } from 'mppx'
import { z } from 'zod/mini'

const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/

/**
 * Stellar charge intent for one-time SAC token transfers.
 *
 * Supports two credential flows:
 * - `type: "transaction"` — **server-broadcast** (pull mode):
 *   Client signs a Soroban SAC `transfer` invocation and sends
 *   the serialised XDR. The server broadcasts it.
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
        /** Pull mode: client signs XDR, server broadcasts. */
        z.object({ xdr: z.string(), type: z.literal('transaction') }),
      ]),
    },
    request: z.object({
      /** Payment amount in base units (stroops). */
      amount: z.string().check(z.regex(DECIMAL_AMOUNT_PATTERN)),
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
  const [whole = '0', frac = ''] = parseDecimalAmount(amount)
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  const factor = 10n ** BigInt(decimals)
  return (BigInt(whole) * factor + BigInt(paddedFrac || '0')).toString()
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
  const divisor = 10n ** BigInt(decimals)
  const whole = (bi / divisor).toString()
  const remainder = (bi % divisor).toString().padStart(decimals, '0')
  return `${whole}.${remainder}`
}

function parseDecimalAmount(amount: string): [string, string] {
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) {
    throw new Error(`Invalid amount format: ${amount}`)
  }

  const [whole = '0', frac = ''] = amount.split('.')
  return [whole, frac]
}
