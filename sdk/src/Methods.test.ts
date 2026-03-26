import { describe, expect, it } from 'vitest'
import { Method } from 'mppx'
import * as Methods from './Methods.js'
import { toBaseUnits, fromBaseUnits } from './Methods.js'

// ---------------------------------------------------------------------------
// Amount helpers
// ---------------------------------------------------------------------------

describe('toBaseUnits', () => {
  it('converts whole number', () => {
    expect(toBaseUnits('1', 7)).toBe('10000000')
  })

  it('converts decimal', () => {
    expect(toBaseUnits('0.01', 7)).toBe('100000')
  })

  it('converts zero', () => {
    expect(toBaseUnits('0', 7)).toBe('0')
  })

  it('truncates excess decimals', () => {
    expect(toBaseUnits('1.123456789', 7)).toBe('11234567')
  })

  it('pads fewer decimals', () => {
    expect(toBaseUnits('1.5', 7)).toBe('15000000')
  })

  it('handles negative amounts correctly (NM-006)', () => {
    expect(toBaseUnits('-1.5', 7)).toBe('-15000000')
    expect(toBaseUnits('-0.01', 7)).toBe('-100000')
  })
})

describe('fromBaseUnits', () => {
  it('converts base units to human-readable', () => {
    expect(fromBaseUnits('10000000', 7)).toBe('1.0000000')
  })

  it('converts small amounts', () => {
    expect(fromBaseUnits('100000', 7)).toBe('0.0100000')
  })

  it('roundtrips', () => {
    const base = toBaseUnits('42.1234567', 7)
    expect(fromBaseUnits(base, 7)).toBe('42.1234567')
  })

  it('handles negative amounts correctly (NM-006)', () => {
    expect(fromBaseUnits('-15000000', 7)).toBe('-1.5000000')
    expect(fromBaseUnits('-5000000', 7)).toBe('-0.5000000')
  })

  it('roundtrips negative amounts (NM-006)', () => {
    const base = toBaseUnits('-1.5', 7)
    expect(fromBaseUnits(base, 7)).toBe('-1.5000000')
  })
})

// ---------------------------------------------------------------------------
// Method schema
// ---------------------------------------------------------------------------

describe('Methods.charge', () => {
  it('has correct name and intent', () => {
    expect(Methods.charge.name).toBe('stellar')
    expect(Methods.charge.intent).toBe('charge')
  })

  it('is a valid Method', () => {
    const method = Method.from(Methods.charge)
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('request schema parses amount and currency', () => {
    const result = Methods.charge.schema.request.parse({
      amount: '100000',
      currency: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      recipient: 'GBXYZ',
    })
    expect(result.amount).toBe('100000')
    expect(result.currency).toBe(
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    )
    expect(result.recipient).toBe('GBXYZ')
  })

  it('request schema accepts externalId', () => {
    const result = Methods.charge.schema.request.parse({
      amount: '100000',
      currency: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      recipient: 'GBXYZ',
      externalId: 'order-123',
    })
    expect(result.externalId).toBe('order-123')
  })

  it('request schema accepts methodDetails with reference', () => {
    const result = Methods.charge.schema.request.parse({
      amount: '100000',
      currency: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      recipient: 'GBXYZ',
      methodDetails: {
        reference: 'abc-123',
        network: 'testnet',
      },
    })
    expect(result.methodDetails?.reference).toBe('abc-123')
    expect(result.methodDetails?.network).toBe('testnet')
  })

  it('request schema accepts methodDetails with feePayer', () => {
    const result = Methods.charge.schema.request.parse({
      amount: '100000',
      currency: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      recipient: 'GBXYZ',
      methodDetails: {
        feePayer: true,
        feePayerKey: 'GXYZ...',
      },
    })
    expect(result.methodDetails?.feePayer).toBe(true)
    expect(result.methodDetails?.feePayerKey).toBe('GXYZ...')
  })

  it('request schema allows omitting methodDetails', () => {
    const result = Methods.charge.schema.request.parse({
      amount: '100000',
      currency: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      recipient: 'GBXYZ',
    })
    expect(result.methodDetails).toBeUndefined()
  })

  it('credential payload accepts hash type (push)', () => {
    const result = Methods.charge.schema.credential.payload.parse({
      type: 'hash',
      hash: 'abc123',
    })
    expect(result.type).toBe('hash')
    expect(result.hash).toBe('abc123')
  })

  it('credential payload accepts transaction type (pull)', () => {
    const result = Methods.charge.schema.credential.payload.parse({
      type: 'transaction',
      transaction: 'AAAA...',
    })
    expect(result.type).toBe('transaction')
    expect(result.transaction).toBe('AAAA...')
  })
})
