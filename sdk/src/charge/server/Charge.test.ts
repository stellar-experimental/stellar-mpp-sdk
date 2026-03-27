import { Keypair } from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it, vi } from 'vitest'
import { USDC_SAC_TESTNET } from '../../constants.js'

const mockGetTransaction = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.getTransaction = mockGetTransaction
      }),
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
// request() transform — CAIP-2 network format
// ---------------------------------------------------------------------------

describe('charge request transform', () => {
  it('emits CAIP-2 network in methodDetails (testnet)', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      network: 'testnet',
    })
    const transformed = (method as any).request({
      request: { amount: '1', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.methodDetails.network).toBe('stellar:testnet')
  })

  it('emits CAIP-2 network in methodDetails (pubnet)', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      network: 'public',
    })
    const transformed = (method as any).request({
      request: { amount: '1', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.methodDetails.network).toBe('stellar:pubnet')
  })

  it('includes feePayer when signer is configured', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      signer: Keypair.random(),
    })
    const transformed = (method as any).request({
      request: { amount: '1', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.methodDetails.feePayer).toBe(true)
  })

  it('omits feePayer when no signer configured', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })
    const transformed = (method as any).request({
      request: { amount: '1', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.methodDetails.feePayer).toBeUndefined()
  })

  it('converts amount to base units using decimals', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      decimals: 7,
    })
    const transformed = (method as any).request({
      request: { amount: '0.01', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.amount).toBe('100000')
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
      methodDetails: {
        network: 'stellar:testnet',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: { type: 'hash', hash: opts.hash },
  })
}

describe('charge tx hash dedup', () => {
  it('rejects a second verify with the same tx hash', async () => {
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      envelopeXdr: undefined,
    })

    const store = Store.memory()
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store,
    })

    const hash = 'abc123firstuse'

    const cred1 = makeHashCredential({ hash })
    await expect(
      method.verify({ credential: cred1 as any, request: cred1.challenge.request }),
    ).rejects.toThrow()

    const stored = await store.get(`stellar:charge:hash:${hash}`)
    expect(stored).toBeFalsy()
  })

  it('marks tx hash as used only after successful verification', async () => {
    const store = Store.memory()

    const hash = 'already-used-hash'
    await store.put(`stellar:charge:hash:${hash}`, { usedAt: new Date().toISOString() })

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
