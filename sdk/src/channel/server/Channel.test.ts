import { Keypair } from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it, vi } from 'vitest'

// Hoisted mock stubs — accessible inside the vi.mock factory
const mockGetAccount = vi.fn()
const mockSimulateTransaction = vi.fn()
const mockGetChannelState = vi.fn()
const mockSendTransaction = vi.fn()
const mockGetTransaction = vi.fn()
const mockFromXDR = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  const OriginalTransactionBuilder = actual.TransactionBuilder
  return {
    ...actual,
    TransactionBuilder: Object.assign(
      function (...args: any[]) {
        return new (OriginalTransactionBuilder as any)(...args)
      },
      {
        ...OriginalTransactionBuilder,
        fromXDR: (...args: unknown[]) => mockFromXDR(...args),
      },
    ),
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
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

/** Build a credential for the open action. */
function makeOpenCredential(opts: {
  transaction: string
  amount: string
  signature?: string
  challengeAmount?: string
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
        cumulativeAmount: '0',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: {
      action: 'open',
      transaction: opts.transaction,
      amount: opts.amount,
      signature: opts.signature ?? 'a'.repeat(128),
    },
  })
}

/** Build a signed open credential with a real ed25519 signature. */
function makeSignedOpenCredential(opts: {
  transaction: string
  commitmentBytes: Buffer
  cumulativeAmount: bigint
  challengeAmount: string
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
        cumulativeAmount: '0',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: {
      action: 'open',
      transaction: opts.transaction,
      amount: opts.cumulativeAmount.toString(),
      signature: sigHex,
    },
  })
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

  it('accepts signers for close transaction signing', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      signers: Keypair.random(),
      store: Store.memory(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts signers as array', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      signers: [Keypair.random(), Keypair.random()],
      store: Store.memory(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feeBumpSigner for channel transactions', () => {
    const method = channel({
      channel: CHANNEL_ADDRESS,
      commitmentKey: COMMITMENT_KEY.publicKey(),
      feeBumpSigner: Keypair.random(),
      store: Store.memory(),
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
    ).rejects.toThrow('must be greater than previous cumulative')
  })

  it('rejects zero-amount challenge request', async () => {
    const credential = makeCredential({
      amount: '1000000',
      challengeAmount: '0',
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
    ).rejects.toThrow('Requested amount must be positive')
  })

  it('rejects commitment equal to previous cumulative (no progress)', async () => {
    const store = Store.memory()
    const cumulativeKey = `stellar:channel:cumulative:${CHANNEL_ADDRESS}`
    await store.put(cumulativeKey, { amount: '5000000' })

    // Commitment = 5000000, previous cumulative = 5000000 → reject (must be strictly greater)
    const credential = makeCredential({
      amount: '5000000',
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
    ).rejects.toThrow('must be greater than previous cumulative')
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

  it('rejects close action when signers is not configured', async () => {
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
    ).rejects.toThrow('Close action requires signers')
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

  it('rejects voucher when on-chain check fails (network error)', async () => {
    mockGetChannelState.mockRejectedValueOnce(new Error('network timeout'))

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

    // NM-005: Fail closed — on-chain check failure now rejects the voucher
    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('On-chain state check failed')
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

  it('rejects voucher after channel finalization (NM-001)', async () => {
    const store = Store.memory()
    await store.put(`stellar:channel:finalized:${CHANNEL_ADDRESS}`, {
      finalizedAt: new Date().toISOString(),
      txHash: 'abc123',
      amount: '5000000',
    })

    const credential = makeCredential({
      amount: '1000000',
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
    ).rejects.toThrow('Channel has been finalized')
  })

  it('rejects commitment that exceeds on-chain balance (NM-003)', async () => {
    mockGetChannelState.mockResolvedValueOnce({
      balance: 500000n, // less than commitment
      refundWaitingPeriod: 1000,
      token: 'CTOKEN...',
      from: 'GFROM...',
      to: 'GTO...',
      closeEffectiveAtLedger: null,
      currentLedger: 4000,
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
    ).rejects.toThrow('exceeds channel balance')
  })
})

describe('stellar server channel open action', () => {
  it('rejects open action with invalid signature format', async () => {
    const credential = makeOpenCredential({
      transaction: 'AAAA...base64xdr...',
      amount: '1000000',
      signature: 'not-valid-hex!!',
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
    ).rejects.toThrow('Invalid commitment signature')
  })

  it('rejects open action with wrong-length signature', async () => {
    const credential = makeOpenCredential({
      transaction: 'AAAA...base64xdr...',
      amount: '1000000',
      signature: 'abcdef12', // 8 hex chars, need 128
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
    ).rejects.toThrow('Invalid commitment signature')
  })

  it('rejects open action with invalid commitment signature (bad sig)', async () => {
    const commitmentBytes = Buffer.from('open-test-commitment')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )

    const credential = makeOpenCredential({
      transaction: 'AAAA...base64xdr...',
      amount: '1000000',
      signature: 'ab'.repeat(64), // valid hex, wrong sig
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
    ).rejects.toThrow('Initial commitment signature verification failed')
  })

  it('accepts valid open credential, broadcasts tx, and initialises store', async () => {
    const commitmentBytes = Buffer.from('open-valid-commitment')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )
    mockFromXDR.mockReturnValueOnce({ toXDR: () => 'mock-xdr' })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'open-tx-hash-123' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const store = Store.memory()

    const credential = makeSignedOpenCredential({
      transaction: 'AAAA...base64xdr...',
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
    expect(receipt.reference).toBe('open-tx-hash-123')

    // Verify cumulative was initialised in the store
    const stored = (await store.get(
      `stellar:channel:cumulative:${CHANNEL_ADDRESS}`,
    )) as { amount: string }
    expect(stored.amount).toBe('1000000')
  })

  it('rejects open when transaction broadcast fails', async () => {
    const commitmentBytes = Buffer.from('open-fail-broadcast')
    mockSimulateTransaction.mockResolvedValueOnce(
      successSimResult(commitmentBytes),
    )
    mockFromXDR.mockReturnValueOnce({ toXDR: () => 'mock-xdr' })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'fail-hash' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'FAILED' })

    const credential = makeSignedOpenCredential({
      transaction: 'AAAA...base64xdr...',
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
    ).rejects.toThrow('Open transaction failed')
  })
})
