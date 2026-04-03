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
  const parts = amount.split('.')
  if (parts.length > 2) {
    throw new Error(`Invalid amount: "${amount}" contains multiple decimal points`)
  }
  const [whole = '0', frac = ''] = parts
  if (decimals === 0) return BigInt(whole).toString()
  if (frac.length > decimals) {
    throw new Error(
      `Precision loss: "${amount}" has ${frac.length} fractional digits but only ${decimals} are supported`,
    )
  }
  const paddedFrac = frac.padEnd(decimals, '0')
  const result = (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFrac)).toString()
  if (result === '0' && amount !== '0' && amount !== '0.0') {
    throw new Error(`Precision loss: "${amount}" converts to zero base units with ${decimals} decimals`)
  }
  return result
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
  if (decimals === 0) return bi.toString()
  const divisor = 10n ** BigInt(decimals)
  const whole = (bi / divisor).toString()
  const remainder = (bi % divisor).toString().padStart(decimals, '0')
  return `${whole}.${remainder}`
}
