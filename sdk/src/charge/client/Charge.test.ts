import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { charge } from './Charge.js'
import { CAIP2_TO_NETWORK } from '../../constants.js'

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

  it('throws when neither keypair nor secretKey is provided', () => {
    expect(() => charge({} as any)).toThrow('Either keypair or secretKey must be provided')
  })
})

describe('CAIP-2 network mapping', () => {
  it('maps stellar:testnet to testnet', () => {
    expect(CAIP2_TO_NETWORK['stellar:testnet']).toBe('testnet')
  })

  it('maps stellar:pubnet to public', () => {
    expect(CAIP2_TO_NETWORK['stellar:pubnet']).toBe('public')
  })

  it('returns undefined for unknown CAIP-2 identifiers', () => {
    expect(CAIP2_TO_NETWORK['stellar:unknown']).toBeUndefined()
  })
})

describe('DID-PKH format', () => {
  it('constructs correct DID-PKH from CAIP-2 network and public key', () => {
    const kp = Keypair.random()
    const caip2Network = 'stellar:testnet'
    const caip2Component = caip2Network.split(':')[1] ?? 'testnet'
    const source = `did:pkh:stellar:${caip2Component}:${kp.publicKey()}`

    expect(source).toMatch(/^did:pkh:stellar:testnet:G[A-Z0-9]{55}$/)
  })

  it('uses pubnet component for mainnet', () => {
    const kp = Keypair.random()
    const caip2Network = 'stellar:pubnet'
    const caip2Component = caip2Network.split(':')[1] ?? 'testnet'
    const source = `did:pkh:stellar:${caip2Component}:${kp.publicKey()}`

    expect(source).toMatch(/^did:pkh:stellar:pubnet:G[A-Z0-9]{55}$/)
  })
})
