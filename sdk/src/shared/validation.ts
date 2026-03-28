import { StellarMppError } from './errors.js'

export function validateHexSignature(hex: string, expectedLength: number = 128): void {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0 || hex.length !== expectedLength) {
    throw new StellarMppError(
      `Invalid signature: expected ${expectedLength} hex characters, got ${hex.length}`,
    )
  }
}

export function validateAmount(amount: string): void {
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new StellarMppError(
      `Invalid amount: "${amount}" must be a positive integer string without leading zeros`,
    )
  }
}
