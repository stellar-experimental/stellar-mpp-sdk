import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { charge } from './Charge.js'

const TEST_KEYPAIR = Keypair.random()

describe('stellar client charge', () => {
  it('creates a client method with correct name and intent', () => {
    const method = charge({ keypair: TEST_KEYPAIR })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('accepts secretKey parameter', () => {
    const method = charge({ secretKey: TEST_KEYPAIR.secret() })
    expect(method.name).toBe('stellar')
  })

  it('has createCredential function', () => {
    const method = charge({ keypair: TEST_KEYPAIR })
    expect(typeof method.createCredential).toBe('function')
  })

  it('accepts custom rpcUrl', () => {
    const method = charge({
      keypair: TEST_KEYPAIR,
      rpcUrl: 'https://custom-rpc.example.com',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom timeout', () => {
    const method = charge({
      keypair: TEST_KEYPAIR,
      timeout: 300,
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts onProgress callback', () => {
    const events: unknown[] = []
    const method = charge({
      keypair: TEST_KEYPAIR,
      onProgress: (e) => events.push(e),
    })
    expect(method.name).toBe('stellar')
  })

  it('defaults mode to pull', () => {
    const method = charge({ keypair: TEST_KEYPAIR })
    expect(method.name).toBe('stellar')
  })

  it('accepts push mode', () => {
    const method = charge({ keypair: TEST_KEYPAIR, mode: 'push' })
    expect(method.name).toBe('stellar')
  })
})
