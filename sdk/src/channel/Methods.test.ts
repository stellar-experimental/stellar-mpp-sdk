import { describe, expect, it } from 'vitest'
import { Method } from 'mppx'
import { channel } from './Methods.js'

describe('channel method schema', () => {
  it('has correct name and intent', () => {
    expect(channel.name).toBe('stellar')
    expect(channel.intent).toBe('channel')
  })

  it('is a valid Method', () => {
    const method = Method.from(channel)
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('channel')
  })

  it('request schema parses amount and channel', () => {
    const result = channel.schema.request.parse({
      amount: '1000000',
      channel: 'CABC123',
    })
    expect(result.amount).toBe('1000000')
    expect(result.channel).toBe('CABC123')
  })

  it('request schema accepts externalId', () => {
    const result = channel.schema.request.parse({
      amount: '1000000',
      channel: 'CABC123',
      externalId: 'order-456',
    })
    expect(result.externalId).toBe('order-456')
  })

  it('request schema accepts methodDetails with cumulativeAmount', () => {
    const result = channel.schema.request.parse({
      amount: '1000000',
      channel: 'CABC123',
      methodDetails: {
        reference: 'ref-001',
        network: 'testnet',
        cumulativeAmount: '5000000',
      },
    })
    expect(result.methodDetails?.reference).toBe('ref-001')
    expect(result.methodDetails?.network).toBe('testnet')
    expect(result.methodDetails?.cumulativeAmount).toBe('5000000')
  })

  it('request schema allows omitting methodDetails', () => {
    const result = channel.schema.request.parse({
      amount: '1000000',
      channel: 'CABC123',
    })
    expect(result.methodDetails).toBeUndefined()
  })

  it('credential payload accepts amount and signature', () => {
    const result = channel.schema.credential.payload.parse({
      amount: '3000000',
      signature: 'deadbeef',
    })
    expect(result.amount).toBe('3000000')
    expect(result.signature).toBe('deadbeef')
  })
})
