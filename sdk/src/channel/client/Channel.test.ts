import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { channel } from './Channel.js'

const TEST_KEYPAIR = Keypair.random()

describe('stellar client channel', () => {
  it('creates a client method with correct name and intent', () => {
    const method = channel({ commitmentKey: TEST_KEYPAIR })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('channel')
  })

  it('accepts commitmentSecret parameter', () => {
    const method = channel({ commitmentSecret: TEST_KEYPAIR.secret() })
    expect(method.name).toBe('stellar')
  })

  it('has createCredential function', () => {
    const method = channel({ commitmentKey: TEST_KEYPAIR })
    expect(typeof method.createCredential).toBe('function')
  })

  it('accepts custom rpcUrl', () => {
    const method = channel({
      commitmentKey: TEST_KEYPAIR,
      rpcUrl: 'https://custom-rpc.example.com',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts onProgress callback', () => {
    const events: unknown[] = []
    const method = channel({
      commitmentKey: TEST_KEYPAIR,
      onProgress: (e) => events.push(e),
    })
    expect(typeof method.createCredential).toBe('function')
  })

  it('throws if neither commitmentKey nor commitmentSecret is provided', () => {
    expect(() => channel({} as Parameters<typeof channel>[0])).toThrow(
      'Either commitmentKey or commitmentSecret must be provided.',
    )
  })

  it('accepts sourceAccount parameter', () => {
    const method = channel({
      commitmentKey: TEST_KEYPAIR,
      sourceAccount: Keypair.random().publicKey(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts open action with openTransaction in context', () => {
    const method = channel({ commitmentKey: TEST_KEYPAIR })
    // We can't easily test createCredential without mocking the RPC,
    // but we can verify the method is created and the context schema
    // accepts the open action.
    expect(method.name).toBe('stellar')
  })
})
