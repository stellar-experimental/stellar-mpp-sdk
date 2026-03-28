import {
  Account,
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { Challenge } from 'mppx'
import { describe, expect, it, vi } from 'vitest'
import { CAIP2_TO_NETWORK, USDC_SAC_TESTNET } from '../../constants.js'

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockGetAccount = vi.fn()
const mockPrepareTransaction = vi.fn()
const mockGetLatestLedger = vi.fn()
const mockSendTransaction = vi.fn()
const mockGetTransaction = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.getAccount = mockGetAccount
        this.prepareTransaction = mockPrepareTransaction
        this.getLatestLedger = mockGetLatestLedger
        this.sendTransaction = mockSendTransaction
        this.getTransaction = mockGetTransaction
      }),
    },
  }
})

const { charge } = await import('./Charge.js')

const TEST_KEYPAIR = Keypair.random()
const RECIPIENT = Keypair.random().publicKey()

function mockChallenge(overrides: Record<string, unknown> = {}) {
  return Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: '100000',
      currency: USDC_SAC_TESTNET,
      recipient: RECIPIENT,
      methodDetails: {
        network: 'stellar:testnet',
      },
      ...overrides,
    },
  })
}

function buildMockPreparedTx() {
  const account = new Account(TEST_KEYPAIR.publicKey(), '0')
  const contract = new Contract(USDC_SAC_TESTNET)
  const transferOp = contract.call(
    'transfer',
    new Address(TEST_KEYPAIR.publicKey()).toScVal(),
    new Address(RECIPIENT).toScVal(),
    nativeToScVal(100000n, { type: 'i128' }),
  )
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: 'Test SDF Network ; September 2015',
  })
    .addOperation(transferOp)
    .setTimeout(180)
    .build()
}

// ── Construction tests ─────────────────────────────────────────────────────

describe('stellar client charge', () => {
  it('creates a client method with correct name and intent', () => {
    const method = charge({ keypair: TEST_KEYPAIR })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('accepts secretKey parameter', () => {
    const method = charge({ secretKey: TEST_KEYPAIR.secret() })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('has createCredential function', () => {
    const method = charge({ keypair: TEST_KEYPAIR })
    expect(typeof method.createCredential).toBe('function')
  })

  it('throws when neither keypair nor secretKey is provided', () => {
    expect(() => charge({} as any)).toThrow('Either keypair or secretKey must be provided')
  })
})

// ── createCredential behaviour ─────────────────────────────────────────────

describe('charge createCredential', () => {
  it('rejects push mode with server-sponsored fee (feePayer=true)', async () => {
    const method = charge({ keypair: TEST_KEYPAIR, mode: 'push' })
    const challenge = mockChallenge({
      methodDetails: { network: 'stellar:testnet', feePayer: true },
    })

    await expect(
      method.createCredential({ challenge: challenge as any, context: {} as any }),
    ).rejects.toThrow('Push mode is not supported for server-sponsored transactions')
  })

  it('allows overriding mode via context', async () => {
    // Default mode is pull, but context can override to push
    const method = charge({ keypair: TEST_KEYPAIR, mode: 'pull' })
    const challenge = mockChallenge({
      methodDetails: { network: 'stellar:testnet', feePayer: true },
    })

    // Push via context + feePayer should still throw
    await expect(
      method.createCredential({
        challenge: challenge as any,
        context: { mode: 'push' } as any,
      }),
    ).rejects.toThrow('Push mode is not supported for server-sponsored transactions')
  })

  it('fires onProgress events during unsponsored pull flow', async () => {
    const account = new Account(TEST_KEYPAIR.publicKey(), '0')
    mockGetAccount.mockResolvedValueOnce(account)
    const mockTx = buildMockPreparedTx()
    mockPrepareTransaction.mockResolvedValueOnce(await mockTx)

    const events: unknown[] = []
    const method = charge({
      keypair: TEST_KEYPAIR,
      onProgress: (e) => events.push(e),
    })

    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    // Verify progress events were emitted in order
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect((events[0] as any).type).toBe('challenge')
    expect((events[0] as any).recipient).toBe(RECIPIENT)
    expect((events[1] as any).type).toBe('signing')
    expect((events[2] as any).type).toBe('signed')
    expect((events[2] as any).transaction).toBeDefined()

    // Credential should be a string (serialized)
    expect(typeof credential).toBe('string')
    expect(credential).toMatch(/^Payment\s+/)
  })

  it('produces a transaction credential in pull mode', async () => {
    const account = new Account(TEST_KEYPAIR.publicKey(), '0')
    mockGetAccount.mockResolvedValueOnce(account)
    const mockTx = buildMockPreparedTx()
    mockPrepareTransaction.mockResolvedValueOnce(await mockTx)

    const method = charge({ keypair: TEST_KEYPAIR, mode: 'pull' })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    // Decode the credential
    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))

    expect(decoded.payload.type).toBe('transaction')
    expect(typeof decoded.payload.transaction).toBe('string')
    expect(decoded.source).toMatch(/^did:pkh:stellar:testnet:G/)
  })

  it('broadcasts and produces hash credential in push mode', async () => {
    const account = new Account(TEST_KEYPAIR.publicKey(), '0')
    mockGetAccount.mockResolvedValueOnce(account)
    const mockTx = buildMockPreparedTx()
    mockPrepareTransaction.mockResolvedValueOnce(await mockTx)
    mockSendTransaction.mockResolvedValueOnce({ hash: 'push-tx-hash-abc' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const events: unknown[] = []
    const method = charge({
      keypair: TEST_KEYPAIR,
      mode: 'push',
      onProgress: (e) => events.push(e),
    })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    // Should have additional push-mode events
    const types = events.map((e: any) => e.type)
    expect(types).toContain('paying')
    expect(types).toContain('confirming')
    expect(types).toContain('paid')

    // Decode to verify hash payload
    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    expect(decoded.payload.type).toBe('hash')
    expect(decoded.payload.hash).toBe('push-tx-hash-abc')
  })

  it('uses pubnet DID component for public network', async () => {
    const account = new Account(TEST_KEYPAIR.publicKey(), '0')
    mockGetAccount.mockResolvedValueOnce(account)
    const mockTx = buildMockPreparedTx()
    mockPrepareTransaction.mockResolvedValueOnce(await mockTx)

    const method = charge({ keypair: TEST_KEYPAIR })
    const challenge = mockChallenge({
      methodDetails: { network: 'stellar:pubnet' },
    })

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    expect(decoded.source).toMatch(/^did:pkh:stellar:pubnet:G/)
  })
})

// ── CAIP-2 and DID-PKH ────────────────────────────────────────────────────

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
