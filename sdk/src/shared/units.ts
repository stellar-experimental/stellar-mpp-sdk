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
