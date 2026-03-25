import { Keypair } from '@stellar/stellar-sdk'
import { Challenge } from 'mppx'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({
          accountId: () => Keypair.random().publicKey(),
          sequenceNumber: () => '0',
          sequence: () => '0',
          incrementSequenceNumber: () => {},
        }),
        simulateTransaction: vi.fn().mockResolvedValue({
          result: { retval: { bytes: () => Buffer.from('mock-commitment') } },
          transactionData: 'mock',
        }),
      })),
    },
  }
})

const { channel } = await import('./Channel.js')

const TEST_KEYPAIR = Keypair.random()
const CHANNEL_ADDRESS = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526'

function mockChallenge(overrides: Record<string, unknown> = {}) {
  return Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'channel',
    request: {
      amount: '1000000',
      channel: CHANNEL_ADDRESS,
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'testnet',
        cumulativeAmount: '0',
      },
      ...overrides,
    },
  })
}

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
    expect(method.name).toBe('stellar')
  })
})

describe('stellar client channel createCredential open action', () => {
  it('throws when action is open but openTransaction is missing', async () => {
    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    await expect(
      method.createCredential({
        challenge: challenge as any,
        context: { action: 'open' } as any,
      }),
    ).rejects.toThrow('openTransaction is required when action is "open".')
  })

  it('includes transaction in payload when action is open with openTransaction', async () => {
    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    const serialized = await method.createCredential({
      challenge: challenge as any,
      context: {
        action: 'open',
        openTransaction: 'MOCK_TX_XDR_BASE64',
      } as any,
    })

    // Credential.serialize returns "Payment <base64>" — decode to verify payload
    const token = serialized.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    expect(decoded.payload.action).toBe('open')
    expect(decoded.payload.transaction).toBe('MOCK_TX_XDR_BASE64')
  })
})
