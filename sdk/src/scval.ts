import { xdr } from '@stellar/stellar-sdk'

/**
 * Convert a Soroban ScVal to a BigInt.
 *
 * Handles u32, i32, u64, i64, u128, and i128 types. The lo limb is
 * masked to 64 bits so that unsigned Uint64 values are treated correctly
 * regardless of the host representation.
 */
export function scValToBigInt(val: xdr.ScVal): bigint {
  const switchValue = val.switch().value
  // scvU32 = 3
  if (switchValue === xdr.ScValType.scvU32().value) {
    return BigInt(val.u32())
  }
  // scvI32 = 4
  if (switchValue === xdr.ScValType.scvI32().value) {
    return BigInt(val.i32())
  }
  // scvU64 = 5
  if (switchValue === xdr.ScValType.scvU64().value) {
    return BigInt(val.u64().toString())
  }
  // scvI64 = 6
  if (switchValue === xdr.ScValType.scvI64().value) {
    return BigInt(val.i64().toString())
  }
  // scvU128 = 9
  if (switchValue === xdr.ScValType.scvU128().value) {
    const parts = val.u128()
    const hi = BigInt(parts.hi().toString())
    const lo = BigInt(parts.lo().toString()) & 0xFFFFFFFFFFFFFFFFn
    return (hi << 64n) | lo
  }
  // scvI128 = 10
  if (switchValue === xdr.ScValType.scvI128().value) {
    const parts = val.i128()
    const hi = BigInt(parts.hi().toString())
    const lo = BigInt(parts.lo().toString()) & 0xFFFFFFFFFFFFFFFFn
    return (hi << 64n) | lo
  }
  throw new Error(`Cannot convert ScVal type ${switchValue} to BigInt`)
}
