import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      store: Store.memory(),
    })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('has a verify function', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store: Store.memory(),
    })
    expect(typeof method.verify).toBe('function')
  })

  it('defaults to in-memory store when store is omitted', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom network', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store: Store.memory(),
      network: 'stellar:pubnet',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom rpcUrl', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store: Store.memory(),
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
      store: Store.memory(),
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
      store: Store.memory(),
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
      store: Store.memory(),
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
      store: Store.memory(),
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
      store: Store.memory(),
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

function makeHashCredential(opts: { hash: string; challengeId?: string; source?: string }) {
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
  const cred = Credential.from({
    challenge,
    payload: { type: 'hash', hash: opts.hash },
  })
  // source is explicitly settable; omitting it tests the "no source" rejection path
  if (opts.source !== undefined) {
    return Object.assign(cred, { source: opts.source })
  }
  return cred
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
      store: Store.memory(),
    })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Push mode (type="hash") is not allowed with feePayer=true')
  })
})

describe('charge push-mode sender verification (hash-theft attack prevention)', () => {
  it('rejects hash where the on-chain `from` does not match the credential source', async () => {
    // Attack: attacker steals a client's tx hash and submits it with their own challenge.
    // The tx transfers from LEGITIMATE_CLIENT but the attacker's credential claims
    // source = ATTACKER. The server must compare args[0] against credential.source.
    const legitimateClient = Keypair.random()
    const tx = buildTransferTx({
      source: legitimateClient.publicKey(),
      from: legitimateClient.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(legitimateClient)

    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const attackerKey = Keypair.random().publicKey()
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
    // Attacker's credential claims their own key as source
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'hash', hash: 'stolen-hash' } }),
      { source: `did:pkh:stellar:testnet:${attackerKey}` },
    )

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transfer "from" does not match')
  })

  it('accepts hash where the on-chain `from` matches the credential source', async () => {
    const client = PAYER // PAYER key defined in test scope
    const tx = buildTransferTx({
      source: client.publicKey(),
      from: client.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(client)

    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

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
    // Credential source matches the actual `from` in the tx
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'hash', hash: 'legit-hash' } }),
      { source: `did:pkh:stellar:testnet:${client.publicKey()}` },
    )

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    const receipt = await method.verify({
      credential: cred as any,
      request: cred.challenge.request,
    })
    expect(receipt.status).toBe('success')
  })

  it('rejects credential with no source (source is mandatory)', async () => {
    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: 'unused',
    })

    const cred = makeHashCredential({ hash: 'no-source-hash' }) // source field absent

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Credential source is required')
  })

  it('rejects credential with malformed source DID', async () => {
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS', envelopeXdr: 'unused' })
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
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'hash', hash: 'bad-did-hash' } }),
      { source: 'not-a-valid-did' },
    )

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('invalid format')
  })

  it('rejects source DID with non-stellar namespace', async () => {
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS', envelopeXdr: 'unused' })
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
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'hash', hash: 'eip155-hash' } }),
      { source: `did:pkh:eip155:1:0xabc123` },
    )

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('invalid format')
  })

  it('rejects source DID with invalid Stellar public key', async () => {
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS', envelopeXdr: 'unused' })
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
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'hash', hash: 'bad-key-hash' } }),
      { source: 'did:pkh:stellar:testnet:NOT_A_VALID_KEY' },
    )

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('invalid Stellar public key')
  })
})

describe('charge push-mode verification (NM-001 regression)', () => {
  it('rejects hash whose on-chain tx has wrong amount (NM-001)', async () => {
    // Before the fix, verifySacTransfer swallowed all errors — any successful on-chain tx
    // would be accepted as payment. Now it must throw on wrong transfer parameters.
    const wrongAmountTx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 5000000n, // wrong — challenge expects 10000000
      currency: USDC_SAC_TESTNET,
    })
    wrongAmountTx.sign(PAYER)

    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: wrongAmountTx.toXDR(),
    })

    const cred = makeHashCredential({
      hash: 'wrong-amount-tx-hash',
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transfer amount does not match')
  })

  it('rejects hash whose on-chain tx transfers to wrong recipient (NM-001)', async () => {
    const wrongRecipient = Keypair.random().publicKey()
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: wrongRecipient,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const cred = makeHashCredential({
      hash: 'wrong-recipient-tx-hash',
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transfer "to" does not match')
  })

  it('rejects hash whose on-chain tx uses wrong currency (NM-001)', async () => {
    const wrongCurrency = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: wrongCurrency, // wrong SAC contract
    })
    tx.sign(PAYER)

    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const cred = makeHashCredential({
      hash: 'wrong-currency-tx-hash',
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Contract address does not match')
  })

  it('rejects hash when on-chain tx has no envelopeXdr (NM-001)', async () => {
    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: undefined,
    })

    const cred = makeHashCredential({
      hash: 'no-envelope-hash',
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('missing envelope XDR')
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

function makeTransactionCredential(
  txXdr: string,
  challengeAmount: string = '10000000',
  source: string = `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
) {
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
  return Object.assign(
    Credential.from({ challenge, payload: { type: 'transaction', transaction: txXdr } }),
    { source },
  )
}

function makeMockTransferEvent(
  from: string,
  to: string,
  amount: bigint,
  contract: string,
) {
  const fromScVal = new Address(from).toScVal()
  const toScVal = new Address(to).toScVal()
  const amountScVal = nativeToScVal(amount, { type: 'i128' })

  return {
    event: () => ({
      type: () => ({ value: 0 }),
      contractId: () => Address.fromString(contract).toBuffer().subarray(0, 32),
      body: () => ({
        v0: () => ({
          topics: () => [
            { sym: () => ({ toString: () => 'transfer' }) },
            fromScVal,
            toScVal,
          ],
          data: () => amountScVal,
        }),
      }),
    }),
  }
}

function defaultMockEvent() {
  return makeMockTransferEvent(PAYER.publicKey(), RECIPIENT, 10000000n, USDC_SAC_TESTNET)
}

describe('charge transaction verification', () => {
  it('rejects a transaction with exactly one payment operation', async () => {
    const tx = new TransactionBuilder(new Account(PAYER.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: RECIPIENT,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(180)
      .build()
    tx.sign(PAYER)

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('does not contain a Soroban invocation')
  })

  it('rejects a sponsored transaction with exactly one payment operation', async () => {
    const tx = new TransactionBuilder(new Account(ALL_ZEROS, '0'), {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: RECIPIENT,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(180)
      .build()

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
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'transaction', transaction: tx.toXDR() } }),
      { source: `did:pkh:stellar:testnet:${PAYER.publicKey()}` },
    )

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: Keypair.random() },
      store: Store.memory(),
    })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('does not contain a Soroban invocation')
  })

  it('rejects transaction where from address does not match credential source', async () => {
    const actualPayer = Keypair.random()
    const tx = buildTransferTx({
      source: actualPayer.publicKey(),
      from: actualPayer.publicKey(), // tx was built by actualPayer
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(actualPayer)

    // Credential claims PAYER as source, but tx `from` is actualPayer — mismatch
    const cred = Object.assign(makeTransactionCredential(tx.toXDR()), {
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transfer "from" does not match')
  })

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

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transfer "to" does not match')
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

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Transfer amount does not match')
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

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Contract address does not match')
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
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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
      events: [defaultMockEvent()],
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
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'transaction', transaction: tx.toXDR() } }),
      { source: `did:pkh:stellar:testnet:${PAYER.publicKey()}` },
    )

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
    const cred = Object.assign(
      Credential.from({ challenge, payload: { type: 'transaction', transaction: tx.toXDR() } }),
      { source: `did:pkh:stellar:testnet:${PAYER.publicKey()}` },
    )

    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'verified-tx-hash' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockRejectedValueOnce(new Error('RPC down'))

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'unconfirmed-hash' })
    mockGetTransaction.mockResolvedValue({ status: 'FAILED', resultXdr: 'tx_failed' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'error-hash', status: 'ERROR' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'dup-hash', status: 'DUPLICATE' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

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

describe('charge simulation event validation', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset()
    mockSendTransaction.mockReset()
    mockGetTransaction.mockReset()
  })

  it('rejects when simulation returns empty events array', async () => {
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

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('no transfer events')
  })

  it('rejects when simulation events field is undefined', async () => {
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
      transactionData: 'mock',
    })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('no transfer events')
  })

  it('rejects when simulation has only non-transfer events', async () => {
    const tx = buildTransferTx({
      source: PAYER.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    const nonTransferEvent = {
      event: () => ({
        type: () => ({ value: 0 }),
        contractId: () => null,
        body: () => ({
          v0: () => ({
            topics: () => [
              { sym: () => ({ toString: () => 'mint' }) },
            ],
            data: () => nativeToScVal(0n, { type: 'i128' }),
          }),
        }),
      }),
    }

    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [nonTransferEvent],
      transactionData: 'mock',
    })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('no transfer events')
  })
})

describe('charge transaction structure validation', () => {
  it('rejects transaction with invokeHostFunction + extra payment operation', async () => {
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
      .addOperation(
        Operation.payment({
          destination: PAYER.publicKey(),
          asset: Asset.native(),
          amount: '5000',
        }),
      )
      .setTimeout(180)
      .build()
    tx.sign(PAYER)

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('must contain exactly one operation')
  })

  it('rejects transaction with invokeHostFunction + setOptions operation', async () => {
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
      .addOperation(Operation.setOptions({}))
      .setTimeout(180)
      .build()
    tx.sign(PAYER)

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('must contain exactly one operation')
  })
})

describe('charge SAC invocation validation (fail-closed)', () => {
  it('rejects non-transfer function name with specific error', async () => {
    const account = new Account(PAYER.publicKey(), '0')
    const contract = new Contract(USDC_SAC_TESTNET)
    const approveOp = contract.call(
      'approve',
      new Address(PAYER.publicKey()).toScVal(),
      new Address(RECIPIENT).toScVal(),
      nativeToScVal(10000000n, { type: 'i128' }),
    )
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(approveOp)
      .setTimeout(180)
      .build()
    tx.sign(PAYER)

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('Function name must be "transfer"')
  })
})

describe('charge server signing address protection', () => {
  it('rejects unsponsored tx with source matching server signer', async () => {
    const signerKp = Keypair.random()
    const tx = buildTransferTx({
      source: signerKp.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    const cred = Object.assign(makeTransactionCredential(tx.toXDR()), {
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: signerKp },
      store: Store.memory(),
    })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('must not be a server signing address')
  })

  it('rejects tx with source matching fee bump signer', async () => {
    const signerKp = Keypair.random()
    const feeBumpKp = Keypair.random()
    const tx = buildTransferTx({
      source: feeBumpKp.publicKey(),
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })
    tx.sign(PAYER)

    const cred = Object.assign(makeTransactionCredential(tx.toXDR()), {
      source: `did:pkh:stellar:testnet:${PAYER.publicKey()}`,
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: signerKp, feeBumpSigner: feeBumpKp },
      store: Store.memory(),
    })

    await expect(
      method.verify({ credential: cred as any, request: cred.challenge.request }),
    ).rejects.toThrow('must not be a server signing address')
  })

  it('allows tx when no feePayer is configured', async () => {
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
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'ok-hash', status: 'PENDING' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const cred = makeTransactionCredential(tx.toXDR())
    const method = charge({ recipient: RECIPIENT, currency: USDC_SAC_TESTNET, store: Store.memory() })

    const receipt = await method.verify({
      credential: cred as any,
      request: cred.challenge.request,
    })
    expect(receipt.status).toBe('success')
  })
})

describe('charge sponsored path fee cap', () => {
  it('caps the rebuilt transaction fee to maxFeeBumpStroops', async () => {
    const signerKp = Keypair.random()

    const tx = buildTransferTx({
      source: ALL_ZEROS,
      from: PAYER.publicKey(),
      to: RECIPIENT,
      amount: 10000000n,
      currency: USDC_SAC_TESTNET,
    })

    // Inflate the fee via XDR manipulation
    const envelope = tx.toEnvelope()
    envelope.v1().tx().fee(2147483647)
    const bloatedXdr = envelope.toXDR('base64')

    mockGetAccount.mockResolvedValueOnce(new Account(signerKp.publicKey(), '100'))
    mockGetLatestLedger.mockResolvedValueOnce({ sequence: 1000 })
    mockSimulateTransaction.mockResolvedValueOnce({
      result: { retval: null },
      events: [defaultMockEvent()],
      transactionData: 'mock',
    })
    mockSendTransaction.mockResolvedValueOnce({ hash: 'fee-test-hash', status: 'PENDING' })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const challenge = Challenge.from({
      id: `test-${crypto.randomUUID()}`,
      realm: 'localhost',
      method: 'stellar',
      intent: 'charge',
      request: {
        amount: '10000000',
        currency: USDC_SAC_TESTNET,
        recipient: RECIPIENT,
        methodDetails: { network: 'stellar:testnet', feePayer: true },
      },
    })
    const cred = Object.assign(
      Credential.from({
        challenge,
        payload: { type: 'transaction', transaction: bloatedXdr },
      }),
      { source: `did:pkh:stellar:testnet:${PAYER.publicKey()}` },
    )

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: { envelopeSigner: signerKp },
      maxFeeBumpStroops: 10_000_000,
      store: Store.memory(),
    })

    await method.verify({ credential: cred as any, request: cred.challenge.request })

    const sentTx = mockSendTransaction.mock.calls[0][0]
    expect(Number(sentTx.fee)).toBeLessThanOrEqual(10_000_000)
  })
})
