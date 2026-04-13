import { describe, it, expect } from 'vitest'
import { truncate } from './log-utils.js'

describe('truncate', () => {
  it('truncates long strings with default window', () => {
    expect(truncate('CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526')).toBe('CAAQ...C526')
  })

  it('returns short strings unchanged', () => {
    expect(truncate('abc')).toBe('abc')
  })

  it('returns strings at boundary length unchanged', () => {
    // head(4) + tail(4) + "..."(3) = 11 — strings <= 11 chars are unchanged
    expect(truncate('12345678901')).toBe('12345678901')
  })

  it('truncates strings just over boundary', () => {
    expect(truncate('123456789012')).toBe('1234...9012')
  })

  it('handles empty string', () => {
    expect(truncate('')).toBe('')
  })

  it('supports custom window sizes', () => {
    expect(truncate('abcdefghijklmnop', { head: 2, tail: 2 })).toBe('ab...op')
  })

  it('strips control characters', () => {
    expect(truncate('ab\ncd\x00ef')).toBe('abcdef')
  })

  it('strips control characters before measuring length', () => {
    // "ab\ncd" → sanitised "abcd" (4 chars) → too short to truncate
    expect(truncate('ab\ncd')).toBe('abcd')
  })
})
