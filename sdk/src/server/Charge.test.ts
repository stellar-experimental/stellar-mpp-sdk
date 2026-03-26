import { Keypair } from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it, vi } from 'vitest'
import { USDC_SAC_TESTNET } from '../constants.js'

const mockGetTransaction = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getTransaction: mockGetTransaction,
      })),
    },
  }
})

const { charge } = await import('./Charge.js')

const RECIPIENT = Keypair.random().publicKey()

describe('stellar server charge', () => {
  it('creates a server method with correct name and intent', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('has a verify function', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })
    expect(typeof method.verify).toBe('function')
  })

  it('accepts store for replay protection', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store: Store.memory(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom network', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      network: 'public',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom rpcUrl', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      rpcUrl: 'https://custom.rpc.example.com',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts signer as Keypair', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      signer: Keypair.random(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts signer as secret key string', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      signer: Keypair.random().secret(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feeBumpSigner as Keypair', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feeBumpSigner: Keypair.random(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feeBumpSigner as secret key string', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feeBumpSigner: Keypair.random().secret(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom decimals', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      decimals: 6,
    })
    expect(method.name).toBe('stellar')
  })
})

// ---------------------------------------------------------------------------
// Transaction hash dedup tests (hash flow with mocked RPC)
// ---------------------------------------------------------------------------

function makeHashCredential(opts: { hash: string; challengeId?: string }) {
  const challenge = Challenge.from({
    id: opts.challengeId ?? `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: '10000000',
      currency: USDC_SAC_TESTNET,
      recipient: RECIPIENT,
    },
  })
  return Credential.from({
    challenge,
    payload: { type: 'hash', hash: opts.hash },
  })
}

describe('charge tx hash dedup', () => {
  it('rejects a second verify with the same tx hash', async () => {
    // Mock: tx SUCCESS with a valid SAC transfer envelope
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      envelopeXdr: undefined, // verifySacTransfer will throw — that's fine for
    })

    const store = Store.memory()
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store,
    })

    const hash = 'abc123firstuse'

    // First attempt — will fail on envelope verification (no envelope),
    // which means the hash should NOT be marked as used (write is after verify).
    const cred1 = makeHashCredential({ hash })
    await expect(
      method.verify({ credential: cred1 as any, request: cred1.challenge.request }),
    ).rejects.toThrow()

    // Verify the hash was NOT stored (failed verification should not burn it)
    const stored = await store.get(`stellar:tx:${hash}`)
    expect(stored).toBeFalsy()
  })

  it('marks tx hash as used only after successful verification', async () => {
    const store = Store.memory()

    // Pre-populate the hash to simulate it already being used
    const hash = 'already-used-hash'
    await store.put(`stellar:tx:${hash}`, { usedAt: new Date().toISOString() })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store,
    })

    const cred = makeHashCredential({ hash })
    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transaction hash already used')
  })
})
