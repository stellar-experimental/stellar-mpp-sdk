import { describe, expect, it } from 'vitest'
import { xdr } from '@stellar/stellar-sdk'
import { scValToBigInt } from './scval.js'

describe('scValToBigInt', () => {
  it('converts scvU32', () => {
    const val = xdr.ScVal.scvU32(42)
    expect(scValToBigInt(val)).toBe(42n)
  })

  it('converts scvI32', () => {
    const val = xdr.ScVal.scvI32(-7)
    expect(scValToBigInt(val)).toBe(-7n)
  })

  it('converts scvU64', () => {
    const val = xdr.ScVal.scvU64(new xdr.Uint64(1_000_000))
    expect(scValToBigInt(val)).toBe(1_000_000n)
  })

  it('converts scvI64', () => {
    const val = xdr.ScVal.scvI64(new xdr.Int64(-500))
    expect(scValToBigInt(val)).toBe(-500n)
  })

  it('converts scvU128', () => {
    const val = xdr.ScVal.scvU128(
      new xdr.UInt128Parts({ hi: new xdr.Uint64(1), lo: new xdr.Uint64(1) }),
    )
    expect(scValToBigInt(val)).toBe((1n << 64n) | 1n)
  })

  it('converts scvI128', () => {
    const val = xdr.ScVal.scvI128(
      new xdr.Int128Parts({ hi: new xdr.Int64(0), lo: new xdr.Uint64(99) }),
    )
    expect(scValToBigInt(val)).toBe(99n)
  })

  it('converts scvU128 zero', () => {
    const val = xdr.ScVal.scvU128(
      new xdr.UInt128Parts({ hi: new xdr.Uint64(0), lo: new xdr.Uint64(0) }),
    )
    expect(scValToBigInt(val)).toBe(0n)
  })

  it('throws for unsupported ScVal type', () => {
    const val = xdr.ScVal.scvBool(true)
    expect(() => scValToBigInt(val)).toThrow('Cannot convert ScVal type')
  })
})
