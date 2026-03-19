import { Keypair } from '@stellar/stellar-sdk'
import { Store } from 'mppx'
import { describe, expect, it } from 'vitest'
import { channel } from './Channel.js'

const COMMITMENT_KEY = Keypair.random()
const CHANNEL_ADDRESS = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM'

describe('stellar server channel', () => {
  it('creates a server method with correct name and intent', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
    })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('channel')
  })

  it('has a verify function', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
    })
    expect(typeof method.verify).toBe('function')
  })

  it('accepts store for replay protection', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      store: Store.memory(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom network', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      network: 'public',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom rpcUrl', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      rpcUrl: 'https://custom.rpc.example.com',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts commitmentKey as Keypair', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom decimals', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      decimals: 6,
    })
    expect(method.name).toBe('stellar')
  })
})
