import { describe, it, expect } from 'vitest'
import { StellarMppError, PaymentVerificationError, ChannelVerificationError } from './errors.js'

describe('StellarMppError', () => {
  it('stores message and details', () => {
    const err = new StellarMppError('test error', { key: 'value' })
    expect(err.message).toBe('test error')
    expect(err.details).toEqual({ key: 'value' })
    expect(err).toBeInstanceOf(Error)
  })

  it('defaults details to empty object', () => {
    const err = new StellarMppError('test')
    expect(err.details).toEqual({})
  })
})

describe('PaymentVerificationError', () => {
  it('extends StellarMppError', () => {
    const err = new PaymentVerificationError('payment failed', { hash: 'abc' })
    expect(err).toBeInstanceOf(StellarMppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PaymentVerificationError')
    expect(err.details).toEqual({ hash: 'abc' })
  })
})

describe('ChannelVerificationError', () => {
  it('extends StellarMppError', () => {
    const err = new ChannelVerificationError('channel failed', { channel: 'C...' })
    expect(err).toBeInstanceOf(StellarMppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ChannelVerificationError')
    expect(err.details).toEqual({ channel: 'C...' })
  })
})
