import {
  Account,
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it, vi } from 'vitest'
import { ALL_ZEROS, USDC_SAC_TESTNET } from '../../constants.js'

const mockGetTransaction = vi.fn()
const mockGetAccount = vi.fn()
const mockSimulateTransaction = vi.fn()
const mockSendTransaction = vi.fn()
const mockGetLatestLedger = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.getTransaction = mockGetTransaction
        this.getAccount = mockGetAccount
        this.simulateTransaction = mockSimulateTransaction
        this.sendTransaction = mockSendTransaction
        this.getLatestLedger = mockGetLatestLedger
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
      network: 'stellar:pubnet',
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

  it('accepts feePayer with envelopeSigner as Keypair', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random() },
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feePayer with envelopeSigner as secret key string', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random().secret() },
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feePayer with feeBumpSigner as Keypair', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random(), feeBumpSigner: Keypair.random() },
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feePayer with feeBumpSigner as secret key string', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random(), feeBumpSigner: Keypair.random().secret() },
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
      network: 'stellar:testnet',
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
      network: 'stellar:pubnet',
    })
    const transformed = (method as any).request({
      request: { amount: '1', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.methodDetails.network).toBe('stellar:pubnet')
  })

  it('includes feePayer when feePayer is configured', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random() },
    })
    const transformed = (method as any).request({
      request: { amount: '1', currency: USDC_SAC_TESTNET, recipient: RECIPIENT },
    })
    expect(transformed.methodDetails.feePayer).toBe(true)
  })

  it('omits feePayer when no feePayer configured', () => {
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

describe('charge hash+feePayer rejection', () => {
  it('rejects push mode (type=hash) when feePayer is true', async () => {
    const challenge = Challenge.from({
      id: `test-${crypto.randomUUID()}`,
      realm: 'localhost',
      method: 'stellar',
      intent: 'charge',
      request: {
        amount: '10000000',
        currency: USDC_SAC_TESTNET,
        recipient: RECIPIENT,
        methodDetails: {
          network: 'stellar:testnet',
          feePayer: true,
        },
      },
    })
    const cred = Credential.from({
      challenge,
      payload: { type: 'hash', hash: 'some-tx-hash' },
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random() },
    })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Push mode (type="hash") is not allowed with feePayer=true')
  })
})

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

// ---------------------------------------------------------------------------
// Transaction credential verification tests
// ---------------------------------------------------------------------------

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const PAYER = Keypair.random()

function buildTransferTx(opts: {
  source: string
  from: string
  to: string
  amount: bigint
  currency: string
}) {
  const account = new Account(opts.source, '0')
  const contract = new Contract(opts.currency)
  const transferOp = contract.call(
    'transfer',
    new Address(opts.from).toScVal(),
    new Address(opts.to).toScVal(),
    nativeToScVal(opts.amount, { type: 'i128' }),
  )
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(transferOp)
    .setTimeout(180)
    .build()
}

function makeTransactionCredential(txXdr: string, challengeAmount: string = '10000000') {
  const challenge = Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: challengeAmount,
      currency: USDC_SAC_TESTNET,
      recipient: RECIPIENT,
      methodDetails: {
        network: 'stellar:testnet',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: { type: 'transaction', transaction: txXdr },
  })
}

describe('charge transaction verification', () => {
  it('rejects transaction with wrong recipient', async () => {
    const wrongRecipient = Keypair.random().publicKey()
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: wrongRecipient,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('matching SEP-41 transfer invocation')
  })

  it('rejects transaction with wrong amount', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 5000000n, // wrong amount — challenge expects 10000000
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('matching SEP-41 transfer invocation')
  })

  it('rejects transaction with wrong currency', async () => {
    const wrongCurrency = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: wrongCurrency,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('matching SEP-41 transfer invocation')
  })

  it('rejects sponsored source without feePayer configured', async () => {
    const tx = buildTransferTx({
      source: ALL_ZEROS,
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })

    const cred = makeTransactionCredential(tx.toXDR())
    // No feePayer configured
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('sponsored source account but the server has no feePayer configuration')
  })

  it('rejects unsupported credential type', async () => {
    const challenge = Challenge.from({
      id: `test-${crypto.randomUUID()}`,
      realm: 'localhost',
      method: 'stellar',
      intent: 'charge',
      request: {
        amount: '10000000',
        currency: USDC_SAC_TESTNET,
        recipient: RECIPIENT,
        methodDetails: { network: 'stellar:testnet' },
      },
    })
    const cred = Credential.from({
      challenge,
      payload: { type: 'unknown' as any },
    })

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Unsupported credential type')
  })

  it('rejects replay of same challenge ID', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    // Set up simulation and send to succeed
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValue({ hash: 'test-hash-replay' })
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' })

    const store = Store.memory()
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store })

    const challengeId = `replay-test-${crypto.randomUUID()}`
    const challenge = Challenge.from({
      id: challengeId,
      realm: 'localhost',
      method: 'stellar',
      intent: 'charge',
      request: {
        amount: '10000000',
        currency: USDC_SAC_TESTNET,
        recipient: RECIPIENT,
        methodDetails: { network: 'stellar:testnet' },
      },
    })
    const cred = Credential.from({
      challenge,
      payload: { type: 'transaction', transaction: tx.toXDR() },
    })

    // First call succeeds
    await method.verify({ credential: cred as any, request: cred.challenge.request })

    // Second call with same challenge ID should be rejected
    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Challenge already used')
  })

  it('rejects unsponsored tx with timeBounds.maxTime exceeding challenge expires', async () => {
    const farFuture = Math.floor(Date.now() / 1000) + 86400 // 24h from now
    const account = new Account(PAYER.publicKey(), '0')
    const contract = new Contract(USDC_SAC_TESTNET)
    const transferOp = contract.call(
      'transfer',
      new Address(PAYER.publicKey()).toScVal(),
      new Address(RECIPIENT).toScVal(),
      nativeToScVal(10000000n, { type: 'i128' }),
    )
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(transferOp)
      .setTimebounds(0, farFuture) // maxTime far in the future
      .build()
    tx.sign(PAYER)

    // Challenge expires sooner than the tx maxTime
    const expiresAt = new Date((farFuture - 3600) * 1000).toISOString() // 1h before farFuture
    const challenge = Challenge.from({
      id: `test-${crypto.randomUUID()}`,
      realm: 'localhost',
      method: 'stellar',
      intent: 'charge',
      expires: expiresAt,
      request: {
        amount: '10000000',
        currency: USDC_SAC_TESTNET,
        recipient: RECIPIENT,
        methodDetails: { network: 'stellar:testnet' },
      },
    })
    const cred = Credential.from({
      challenge,
      payload: { type: 'transaction', transaction: tx.toXDR() },
    })

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('timeBounds.maxTime exceeds challenge expires')
  })

  it('verifies and broadcasts valid unsponsored transaction', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'verified-tx-hash' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    const receipt = await method.verify({
      credential: cred as any,
      request: cred.challenge.request,
    })
    expect(receipt.status).toBe('success')
    expect(receipt.reference).toBe('verified-tx-hash')
    expect(receipt.method).toBe('stellar')
  })

  it('throws SettlementError when broadcast fails', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })
    mockSendTransaction.mockRejectedValueOnce(new Error('RPC down'))

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Settlement failed')
  })

  it('throws SettlementError when transaction not confirmed', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'unconfirmed-hash' })
    mockGetTransaction.mockResolvedValue({ status: 'FAILED', resultXdr: 'tx_failed' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow()
  })

  it('throws SettlementError when sendTransaction returns ERROR status', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'error-hash', status: 'ERROR' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('sendTransaction returned ERROR')
  })

  it('throws SettlementError when sendTransaction returns DUPLICATE status', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'dup-hash', status: 'DUPLICATE' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('sendTransaction returned DUPLICATE')
  })

  it('does not burn challenge ID when verification fails', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: Keypair.random().publicKey(), // wrong recipient — will fail verification
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockSimulateTransaction.mockResolvedValue({
      result: { retval: null },
      events: [],
      transactionData: 'mock',
    })

    const store = Store.memory()
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store })

    const challengeId = `burn-test-${crypto.randomUUID()}`
    const challenge = Challenge.from({
      id: challengeId,
      realm: 'localhost',
      method: 'stellar',
      intent: 'charge',
      request: {
        amount: '10000000',
        currency: USDC_SAC_TESTNET,
        recipient: RECIPIENT,
        methodDetails: { network: 'stellar:testnet' },
      },
    })
    const cred = Credential.from({
      challenge,
      payload: { type: 'transaction', transaction: tx.toXDR() },
    })

    // First call fails (wrong recipient)
    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow()

    // Challenge should NOT be burned — store should not have the key
    const stored = await store.get(`stellar:charge:challenge:${challengeId}`)
    expect(stored).toBeFalsy()
  })
})
