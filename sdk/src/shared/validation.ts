import { NETWORK_PASSPHRASE, STELLAR_TESTNET, type NetworkId } from '../constants.js'
import { StellarMppError } from './errors.js'

/**
 * Validates that a string is well-formed hex of a specific length.
 *
 * @param hex - The hex string to validate.
 * @param expectedLength - Required character count (must be even). Defaults to 128 (64-byte ed25519 signature).
 * @throws {StellarMppError} If the string is not valid hex or has the wrong length.
 */
export function validateHexSignature(hex: string, expectedLength: number = 128): void {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0 || hex.length !== expectedLength) {
    throw new StellarMppError(
      `Invalid signature: expected ${expectedLength} hex characters, got ${hex.length}`,
    )
  }
}

/**
 * Resolves an unknown value to a valid {@link NetworkId}.
 *
 * Returns `stellar:testnet` when `network` is nullish. Throws for
 * unrecognised identifiers (including legacy `"testnet"` / `"public"` strings).
 *
 * @param network - Raw network value (typically from a challenge's `methodDetails`).
 * @returns A validated {@link NetworkId}.
 * @throws {StellarMppError} If the value is not a supported network identifier.
 */
export function resolveNetworkId(network: unknown): NetworkId {
  if (network == null) return STELLAR_TESTNET
  if (typeof network === 'string' && network in NETWORK_PASSPHRASE) return network as NetworkId
  const supported = Object.keys(NETWORK_PASSPHRASE).join(', ')
  throw new StellarMppError(
    `Unsupported Stellar network identifier: "${network}". Supported networks: ${supported}`,
  )
}

/**
 * Validates that `amount` is a positive integer string with no leading zeros.
 *
 * Intended for base-unit (stroops) values before they are converted to `BigInt`.
 *
 * @param amount - The string to validate.
 * @throws {StellarMppError} If the string is not a strictly positive integer without leading zeros.
 */
export function validateAmount(amount: string): void {
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new StellarMppError(
      `Invalid amount: "${amount}" must be a positive integer string without leading zeros`,
    )
  }
}
