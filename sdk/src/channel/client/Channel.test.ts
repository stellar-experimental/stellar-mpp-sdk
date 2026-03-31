import { Keypair } from '@stellar/stellar-sdk'
import { Challenge } from 'mppx'
import { describe, expect, it, vi } from 'vitest'

const mockGetAccount = vi.fn()
const mockSimulateTransaction = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.getAccount = mockGetAccount
        this.simulateTransaction = mockSimulateTransaction
      }),
    },
  }
})

const { channel } = await import('./Channel.js')

const TEST_KEYPAIR = Keypair.random()
const CHANNEL_ADDRESS = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526'

// Default mock: getAccount returns a valid account stub
mockGetAccount.mockResolvedValue({
  accountId: () => TEST_KEYPAIR.publicKey(),
  sequenceNumber: () => '0',
  sequence: () => '0',
  incrementSequenceNumber: () => {},
})

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
        network: 'stellar:testnet',
        cumulativeAmount: '0',
      },
      ...overrides,
    },
  })
}

function successSimResult(commitmentBytes: Buffer) {
  return {
    result: {
      retval: {
        bytes: () => commitmentBytes,
      },
    },
    transactionData: 'mock',
  }
}

// ── Construction tests ─────────────────────────────────────────────────────

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
})

// ── createCredential behaviour ─────────────────────────────────────────────

describe('channel createCredential voucher', () => {
  it('signs commitment and produces a valid voucher credential', async () => {
    const commitmentBytes = Buffer.from('test-commitment-bytes')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    // Decode the credential
    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))

    expect(decoded.payload.action).toBe('voucher')
    expect(decoded.payload.amount).toBe('1000000')
    expect(decoded.payload.signature).toMatch(/^[0-9a-f]{128}$/)
  })

  it('computes cumulative amount from previous + requested', async () => {
    const commitmentBytes = Buffer.from('cumulative-test')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge({
      amount: '500000',
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'stellar:testnet',
        cumulativeAmount: '2000000', // previous cumulative
      },
    })

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    // 2000000 + 500000 = 2500000
    expect(decoded.payload.amount).toBe('2500000')
  })

  it('allows overriding cumulative amount via context', async () => {
    const commitmentBytes = Buffer.from('override-test')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: { cumulativeAmount: '9999999' } as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    expect(decoded.payload.amount).toBe('9999999')
  })

  it('produces a valid ed25519 signature', async () => {
    const commitmentBytes = Buffer.from('verify-sig-test')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    const sigBytes = Buffer.from(decoded.payload.signature, 'hex')

    // Verify the signature with the public key
    const valid = TEST_KEYPAIR.verify(commitmentBytes, sigBytes)
    expect(valid).toBe(true)
  })

  it('fires onProgress events in order', async () => {
    const commitmentBytes = Buffer.from('progress-test')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const events: unknown[] = []
    const method = channel({
      commitmentKey: TEST_KEYPAIR,
      onProgress: (e) => events.push(e),
    })
    const challenge = mockChallenge()

    await method.createCredential({
      challenge: challenge as any,
      context: {} as any,
    })

    expect(events.length).toBe(3)
    expect((events[0] as any).type).toBe('challenge')
    expect((events[0] as any).channel).toBe(CHANNEL_ADDRESS)
    expect((events[0] as any).cumulativeAmount).toBe('1000000')
    expect((events[1] as any).type).toBe('signing')
    expect((events[2] as any).type).toBe('signed')
    expect((events[2] as any).cumulativeAmount).toBe('1000000')
  })
})

// ── createCredential open action ───────────────────────────────────────────

describe('channel createCredential open action', () => {
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

  it('includes transaction in payload when action is open', async () => {
    const commitmentBytes = Buffer.from('open-commitment')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {
        action: 'open',
        openTransaction: 'MOCK_TX_XDR_BASE64',
      } as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    expect(decoded.payload.action).toBe('open')
    expect(decoded.payload.transaction).toBe('MOCK_TX_XDR_BASE64')
    expect(decoded.payload.signature).toMatch(/^[0-9a-f]{128}$/)
  })

  it('produces a close credential with correct action', async () => {
    const commitmentBytes = Buffer.from('close-commitment')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge()

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: { action: 'close' } as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    expect(decoded.payload.action).toBe('close')
  })

  it('defaults cumulative to requested amount for open action', async () => {
    const commitmentBytes = Buffer.from('open-default-amount')
    mockSimulateTransaction.mockResolvedValueOnce(successSimResult(commitmentBytes))

    const method = channel({ commitmentKey: TEST_KEYPAIR })
    const challenge = mockChallenge({
      amount: '5000000',
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'stellar:testnet',
        cumulativeAmount: '0', // no previous cumulative for open
      },
    })

    const credential = await method.createCredential({
      challenge: challenge as any,
      context: {
        action: 'open',
        openTransaction: 'TX_XDR',
      } as any,
    })

    const token = credential.replace(/^Payment\s+/, '')
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    // 0 + 5000000 = 5000000
    expect(decoded.payload.amount).toBe('5000000')
  })
})
