import { describe, it, expect } from 'vitest'
import { validateHexSignature, validateAmount } from './validation.js'

describe('validateHexSignature', () => {
  it('accepts valid 128-char hex signature', () => {
    const sig = 'a'.repeat(128)
    expect(() => validateHexSignature(sig)).not.toThrow()
  })

  it('throws on wrong length', () => {
    expect(() => validateHexSignature('abcd')).toThrow()
  })

  it('throws on non-hex characters', () => {
    expect(() => validateHexSignature('z'.repeat(128))).toThrow()
  })

  it('throws on odd-length hex', () => {
    expect(() => validateHexSignature('a'.repeat(127))).toThrow()
  })

  it('accepts custom expected length', () => {
    expect(() => validateHexSignature('abcd1234', 8)).not.toThrow()
  })
})

describe('validateAmount', () => {
  it('accepts valid BigInt string', () => {
    expect(() => validateAmount('1000000')).not.toThrow()
  })

  it('accepts zero', () => {
    expect(() => validateAmount('0')).not.toThrow()
  })

  it('throws on non-numeric string', () => {
    expect(() => validateAmount('abc')).toThrow()
  })

  it('throws on negative', () => {
    expect(() => validateAmount('-100')).toThrow()
  })

  it('throws on empty string', () => {
    expect(() => validateAmount('')).toThrow()
  })

  it('throws on decimal', () => {
    expect(() => validateAmount('1.5')).toThrow()
  })
})
