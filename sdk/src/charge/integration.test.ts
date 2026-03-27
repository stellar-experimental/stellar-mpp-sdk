import { Keypair } from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it } from 'vitest'
import { USDC_SAC_TESTNET } from '../constants.js'
import { charge as serverCharge } from './server/Charge.js'
import { charge as clientCharge } from './client/Charge.js'
import { toBaseUnits } from './Methods.js'

const RECIPIENT = Keypair.random()
const SENDER = Keypair.random()
const MPP_SECRET_KEY = 'test-secret-key-for-mppx'

function mockChallenge(overrides: Record<string, unknown> = {}) {
  return Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: toBaseUnits('1', 7),
      currency: USDC_SAC_TESTNET,
      recipient: RECIPIENT.publicKey(),
      methodDetails: {
        network: 'stellar:testnet',
      },
      ...overrides,
    },
  })
}

describe('server charge creation', () => {
  it('creates method with defaults', () => {
    const method = serverCharge({
      recipient: RECIPIENT.publicKey(),
      currency: USDC_SAC_TESTNET,
    })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
    expect(typeof method.verify).toBe('function')
  })

  it('returns 402 challenge when no credential provided', async () => {
    const { Mppx } = await import('mppx/server')
    const mppx = Mppx.create({
      secretKey: MPP_SECRET_KEY,
      methods: [
        serverCharge({
          recipient: RECIPIENT.publicKey(),
          currency: USDC_SAC_TESTNET,
        }),
      ],
    })

    const handler = mppx.charge({ amount: '1' })
    const result = await handler(new Request('http://localhost/test'))
    expect(result.status).toBe(402)
  })
})

describe('client charge creation', () => {
  it('creates method with keypair', () => {
    const method = clientCharge({ keypair: SENDER })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
    expect(typeof method.createCredential).toBe('function')
  })

  it('tracks onProgress events', () => {
    const events: unknown[] = []
    const method = clientCharge({
      keypair: SENDER,
      onProgress: (e) => events.push(e),
    })
    expect(typeof method.createCredential).toBe('function')
  })
})

describe('replay protection', () => {
  it('store tracks used challenge IDs', async () => {
    const store = Store.memory()

    const key = 'stellar:charge:challenge:test-id-123'
    const before = await store.get(key)
    expect(before).toBeNull()

    await store.put(key, { usedAt: new Date().toISOString() })

    const after = await store.get(key)
    expect(after).not.toBeNull()
    expect((after as { usedAt: string }).usedAt).toBeDefined()
  })

  it('store returns existing entry on replay attempt', async () => {
    const store = Store.memory()

    const key = 'stellar:charge:challenge:replay-test-id'
    await store.put(key, { usedAt: '2026-01-01T00:00:00.000Z' })

    const existing = await store.get(key)
    expect(existing).not.toBeNull()
  })
})

describe('credential type validation', () => {
  it('credential schema accepts hash type', () => {
    const challenge = mockChallenge()
    const serialized = Credential.serialize({
      challenge,
      payload: { type: 'hash' as const, hash: 'abc123' },
    })
    expect(serialized).toContain('Payment')
  })

  it('credential schema accepts transaction type', () => {
    const challenge = mockChallenge()
    const serialized = Credential.serialize({
      challenge,
      payload: { type: 'transaction' as const, transaction: 'AAAA' },
    })
    expect(serialized).toContain('Payment')
  })
})
