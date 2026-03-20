import { Keypair } from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it, vi } from 'vitest'

// Hoisted mock stubs — accessible inside the vi.mock factory
const mockGetAccount = vi.fn()
const mockSimulateTransaction = vi.fn()
const mockGetChannelState = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
      })),
    },
  }
})

vi.mock('./State.js', () => ({
  getChannelState: (...args: unknown[]) => mockGetChannelState(...args),
}))

// Re-import after mock is set up
const { channel } = await import('./Channel.js')

// Default: getAccount returns a minimal account stub with a valid public key
const MOCK_SOURCE_KEY = Keypair.random()
mockGetAccount.mockResolvedValue({
  accountId: () => MOCK_SOURCE_KEY.publicKey(),
  sequenceNumber: () => '0',
  sequence: () => '0',
  incrementSequenceNumber: () => {},
})

const COMMITMENT_KEY = Keypair.random()
const CHANNEL_ADDRESS = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526'

/**
 * Build a fake credential for testing verify().
 */
function makeCredential(opts: {
  action?: 'voucher' | 'close'
  amount: string
  challengeAmount?: string
  cumulativeAmount?: string
  signature?: string
}) {
  const challenge = Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'channel',
    request: {
      amount: opts.challengeAmount ?? opts.amount,
      channel: CHANNEL_ADDRESS,
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'testnet',
        cumulativeAmount: opts.cumulativeAmount ?? '0',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: {
      action: opts.action ?? 'voucher',
      amount: opts.amount,
      signature: opts.signature ?? 'a'.repeat(128),
    },
  })
}

/** Build a credential with a real ed25519 signature over `commitmentBytes`. */
function makeSignedCredential(opts: {
  action?: 'voucher' | 'close'
  commitmentBytes: Buffer
  cumulativeAmount: bigint
  challengeAmount: string
  previousCumulative?: string
}) {
  const sig = COMMITMENT_KEY.sign(opts.commitmentBytes)
  const sigHex = Buffer.from(sig).toString('hex')
  const challenge = Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'channel',
    request: {
      amount: opts.challengeAmount,
      channel: CHANNEL_ADDRESS,
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'testnet',
        cumulativeAmount: opts.previousCumulative ?? '0',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: {
      action: opts.action ?? 'voucher',
      amount: opts.cumulativeAmount.toString(),
      signature: sigHex,
    },
  })
}

/** Create a successful simulation result returning given commitment bytes. */
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

  it('accepts sourceAccount parameter', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      sourceAccount: Keypair.random().publicKey(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts closeKey parameter', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      closeKey: Keypair.random(),
    })
    expect(method.name).toBe('stellar')
  })
})

describe('stellar server channel verification', () => {
  it('rejects underpayment (commitment does not cover requested amount)', async () => {
    // Commitment = 500000, but challenge requests 1000000 → should reject
    const credential = makeCredential({
      amount: '500000',
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('does not cover the requested amount')
  })

  it('rejects commitment below previous cumulative', async () => {
    const store = Store.memory()
    const cumulativeKey = `stellar:channel:cumulative:${CHANNEL_ADDRESS}`
    await store.put(cumulativeKey, { amount: '5000000' })

    // Commitment = 3000000, previous cumulative = 5000000 → reject
    const credential = makeCredential({
      amount: '3000000',
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      store,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('is less than previous cumulative')
  })

  it('rejects invalid hex signature', async () => {
    const credential = makeCredential({
      amount: '1000000',
      challengeAmount: '1000000',
      signature: 'zz-not-hex!!',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Invalid signature')
  })

  it('rejects wrong-length signature', async () => {
    const credential = makeCredential({
      amount: '1000000',
      challengeAmount: '1000000',
      signature: 'abcdef12', // only 8 hex chars, need 128
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Invalid signature length')
  })

  it('rejects invalid ed25519 signature (bad sig, valid hex)', async () => {
    const commitmentBytes = Buffer.from('test-commitment-data')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    // Use a valid-length hex string that is NOT a valid signature
    const credential = makeCredential({
      amount: '1000000',
      challengeAmount: '1000000',
      signature: 'ab'.repeat(64), // 128 hex chars, 64 bytes, but wrong sig
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Commitment signature verification failed')
  })

  it('accepts valid commitment and updates cumulative in store', async () => {
    const commitmentBytes = Buffer.from('valid-commitment-bytes')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const store = Store.memory()
    const cumulativeKey = `stellar:channel:cumulative:${CHANNEL_ADDRESS}`

    const credential = makeSignedCredential({
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      store,
    })

    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    expect(receipt.status).toBe('success')

    // Verify cumulative was updated in the store
    const stored = (await store.get(cumulativeKey)) as { amount: string }
    expect(stored.amount).toBe('1000000')
  })

  it('does not update cumulative on verification failure', async () => {
    const store = Store.memory()
    const cumulativeKey = `stellar:channel:cumulative:${CHANNEL_ADDRESS}`

    // Credential that will fail (underpayment)
    const credential = makeCredential({
      amount: '500000',
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      store,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow()

    // Store should not have been updated
    const stored = await store.get(cumulativeKey)
    expect(stored).toBeNull()
  })

  it('rejects replay of same challenge ID', async () => {
    const commitmentBytes = Buffer.from('replay-test-bytes')
    mockSimulateTransaction.mockResolvedValue(
      successSimResult(commitmentBytes),
    )

    const store = Store.memory()

    const credential = makeSignedCredential({
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      store,
    })

    // First call should succeed
    await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    // Same credential (same challenge.id) should be rejected
    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Replay rejected')
  })

  it('rejects close action when closeKey is not configured', async () => {
    const commitmentBytes = Buffer.from('close-test-bytes')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const credential = makeSignedCredential({
      action: 'close',
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Close action requires a closeKey')
  })
})

describe('stellar server channel dispute detection', () => {
  it('rejects voucher when channel is closed (effective ledger reached)', async () => {
    mockGetChannelState.mockResolvedValueOnce({
      balance: 1000000n,
      refundWaitingPeriod: 1000,
      token: 'CTOKEN...',
      from: 'GFROM...',
      to: 'GTO...',
      closeEffectiveAtLedger: 5000,
      currentLedger: 5500, // past effective → closed
    })

    const credential = makeCredential({
      amount: '1000000',
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      checkOnChainState: true,
      sourceAccount: MOCK_SOURCE_KEY.publicKey(),
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Channel is closed')
  })

  it('calls onDisputeDetected when close_start detected but not yet effective', async () => {
    const disputeState = {
      balance: 1000000n,
      refundWaitingPeriod: 1000,
      token: 'CTOKEN...',
      from: 'GFROM...',
      to: 'GTO...',
      closeEffectiveAtLedger: 6000,
      currentLedger: 5500, // before effective → still open, but dispute started
    }
    mockGetChannelState.mockResolvedValueOnce(disputeState)

    const commitmentBytes = Buffer.from('dispute-test-bytes')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const onDisputeDetected = vi.fn()

    const credential = makeSignedCredential({
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      checkOnChainState: true,
      sourceAccount: MOCK_SOURCE_KEY.publicKey(),
      onDisputeDetected,
    })

    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    // Verification should still succeed (channel not yet closed)
    expect(receipt.status).toBe('success')
    // But dispute callback should have been called
    expect(onDisputeDetected).toHaveBeenCalledWith(disputeState)
  })

  it('continues normally when on-chain check fails (network error)', async () => {
    mockGetChannelState.mockRejectedValueOnce(new Error('network timeout'))

    const commitmentBytes = Buffer.from('network-error-test')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const credential = makeSignedCredential({
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      checkOnChainState: true,
      sourceAccount: MOCK_SOURCE_KEY.publicKey(),
    })

    // Should still succeed — on-chain check failure is non-fatal
    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })
    expect(receipt.status).toBe('success')
  })

  it('caches on-chain state in store', async () => {
    mockGetChannelState.mockResolvedValueOnce({
      balance: 5000000n,
      refundWaitingPeriod: 1000,
      token: 'CTOKEN...',
      from: 'GFROM...',
      to: 'GTO...',
      closeEffectiveAtLedger: null,
      currentLedger: 4000,
    })

    const commitmentBytes = Buffer.from('cache-test-bytes')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const store = Store.memory()

    const credential = makeSignedCredential({
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      checkOnChainState: true,
      sourceAccount: MOCK_SOURCE_KEY.publicKey(),
      store,
    })

    await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    const cached = (await store.get(
      `stellar:channel:state:${CHANNEL_ADDRESS}`,
    )) as { balance: string; currentLedger: number }
    expect(cached).not.toBeNull()
    expect(cached.balance).toBe('5000000')
    expect(cached.currentLedger).toBe(4000)
  })

  it('skips on-chain check when checkOnChainState is false', async () => {
    mockGetChannelState.mockClear()

    const commitmentBytes = Buffer.from('skip-check-bytes')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const credential = makeSignedCredential({
      commitmentBytes,
      cumulativeAmount: 1000000n,
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      // checkOnChainState defaults to false
    })

    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })
    expect(receipt.status).toBe('success')
    expect(mockGetChannelState).not.toHaveBeenCalled()
  })

  it('throws a configuration error when checkOnChainState is true but sourceAccount is missing', async () => {
    const credential = makeCredential({
      amount: '1000000',
      challengeAmount: '1000000',
    })

    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY,
      checkOnChainState: true,
      // sourceAccount intentionally omitted
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('checkOnChainState requires sourceAccount to be set')
  })
})
