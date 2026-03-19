import {
  Account,
  Address,
  Keypair,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { describe, expect, it, vi } from 'vitest'
import { USDC_SAC_TESTNET } from '../constants.js'

// Hoisted mock stubs for rpc.Server
const mockGetTransaction = vi.fn()
const mockSendTransaction = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getTransaction: mockGetTransaction,
        sendTransaction: mockSendTransaction,
      })),
    },
  }
})

const { charge } = await import('./Charge.js')

const RECIPIENT = Keypair.random().publicKey()

// ---------------------------------------------------------------------------
// Helpers to build SAC transfer transactions for tests
// ---------------------------------------------------------------------------

/** Encode a contract ID from raw bytes. */
function makeContractId(seed = 1): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed))
}

/** Build a Transaction containing an invokeHostFunction(transfer) op. */
function buildSacTransferTx(opts: {
  sender: Keypair
  recipientPubkey: string
  contractId: string
  amount: bigint
}) {
  const contractAddr = new Address(opts.contractId).toScAddress()
  const fromAddr = new Address(opts.sender.publicKey()).toScVal()
  const toAddr = new Address(opts.recipientPubkey).toScVal()
  const amountScVal = xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      lo: xdr.Uint64.fromString(opts.amount.toString()),
      hi: xdr.Int64.fromString('0'),
    }),
  )

  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contractAddr,
    functionName: 'transfer',
    args: [fromAddr, toAddr, amountScVal],
  })

  const hostFn = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs)

  const invokeHostFnOp = new xdr.InvokeHostFunctionOp({
    hostFunction: hostFn,
    auth: [],
  })

  const op = new xdr.Operation({
    sourceAccount: null,
    body: xdr.OperationBody.invokeHostFunction(invokeHostFnOp),
  })

  // Build a stub tx to get the envelope, then replace its operations
  const account = new Account(opts.sender.publicKey(), '0')
  const stubTx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .setTimeout(30)
    .build()

  const envelope = xdr.TransactionEnvelope.fromXDR(stubTx.toXDR(), 'base64')
  envelope.v1().tx().operations([op])

  return new Transaction(envelope, Networks.TESTNET)
}

/** Build a mock successful transaction result with envelope XDR. */
function mockTxResult(tx: ReturnType<typeof buildSacTransferTx>) {
  return {
    status: 'SUCCESS' as const,
    envelopeXdr: tx.toXDR(),
  }
}

/** Build a credential for the 'signature' verification path. */
function makeSignatureCredential(opts: {
  hash: string
  amount: string
  currency: string
  recipient: string
}) {
  const challenge = Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: opts.amount,
      currency: opts.currency,
      recipient: opts.recipient,
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'testnet',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: {
      type: 'signature',
      hash: opts.hash,
    },
  })
}

/** Build a credential for the 'transaction' verification path. */
function makeTransactionCredential(opts: {
  txXdr: string
  amount: string
  currency: string
  recipient: string
}) {
  const challenge = Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: opts.txXdr ? opts.amount : '0',
      currency: opts.currency,
      recipient: opts.recipient,
      methodDetails: {
        reference: crypto.randomUUID(),
        network: 'testnet',
      },
    },
  })
  return Credential.from({
    challenge,
    payload: {
      type: 'transaction',
      xdr: opts.txXdr,
    },
  })
}

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

  it('accepts feePayer as secret key string', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: Keypair.random().secret(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feePayer as Keypair', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: Keypair.random(),
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

describe('stellar server charge verification', () => {
  const TEST_CONTRACT = makeContractId(1)
  const SENDER = Keypair.random()

  it('signature path: verifies matching SAC transfer in envelope', async () => {
    const tx = buildSacTransferTx({
      sender: SENDER,
      recipientPubkey: RECIPIENT,
      contractId: TEST_CONTRACT,
      amount: 1000000n,
    })

    mockGetTransaction.mockResolvedValueOnce(mockTxResult(tx))

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeSignatureCredential({
      hash: 'abc123hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    expect(receipt.status).toBe('success')
    expect(receipt.reference).toBe('abc123hash')
  })

  it('signature path: throws when envelope is missing', async () => {
    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      // no envelopeXdr
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeSignatureCredential({
      hash: 'missing-env-hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Transaction envelope is missing')
  })

  it('signature path: throws when tx is not successful', async () => {
    mockGetTransaction.mockResolvedValueOnce({
      status: 'FAILED',
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeSignatureCredential({
      hash: 'failed-tx-hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('is not successful')
  })

  it('signature path: rejects wrong recipient', async () => {
    const wrongRecipient = Keypair.random().publicKey()
    const tx = buildSacTransferTx({
      sender: SENDER,
      recipientPubkey: wrongRecipient,
      contractId: TEST_CONTRACT,
      amount: 1000000n,
    })

    mockGetTransaction.mockResolvedValueOnce(mockTxResult(tx))

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeSignatureCredential({
      hash: 'wrong-recipient-hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('does not contain a matching SAC transfer')
  })

  it('signature path: rejects wrong amount', async () => {
    const tx = buildSacTransferTx({
      sender: SENDER,
      recipientPubkey: RECIPIENT,
      contractId: TEST_CONTRACT,
      amount: 500000n, // wrong — expects 1000000
    })

    mockGetTransaction.mockResolvedValueOnce(mockTxResult(tx))

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeSignatureCredential({
      hash: 'wrong-amount-hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('does not contain a matching SAC transfer')
  })

  it('signature path: rejects wrong contract', async () => {
    const wrongContract = makeContractId(2)
    const tx = buildSacTransferTx({
      sender: SENDER,
      recipientPubkey: RECIPIENT,
      contractId: wrongContract,
      amount: 1000000n,
    })

    mockGetTransaction.mockResolvedValueOnce(mockTxResult(tx))

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeSignatureCredential({
      hash: 'wrong-contract-hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('does not contain a matching SAC transfer')
  })

  it('transaction path: verifies and submits matching SAC transfer', async () => {
    const tx = buildSacTransferTx({
      sender: SENDER,
      recipientPubkey: RECIPIENT,
      contractId: TEST_CONTRACT,
      amount: 1000000n,
    })

    const fakeHash = 'submitted-tx-hash-123'
    mockSendTransaction.mockResolvedValueOnce({ hash: fakeHash })
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeTransactionCredential({
      txXdr: tx.toXDR(),
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    expect(receipt.status).toBe('success')
    expect(receipt.reference).toBe(fakeHash)
  })

  it('transaction path: rejects tx without invokeHostFunction', async () => {
    // Build a tx with no operations (stub) — no invokeHostFunction
    const sender = Keypair.random()
    const account = new Account(sender.publicKey(), '0')
    const stubTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(30)
      .build()

    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
    })

    const credential = makeTransactionCredential({
      txXdr: stubTx.toXDR(),
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('does not contain a Soroban invocation')
  })

  it('replay protection: rejects reused challenge', async () => {
    const tx = buildSacTransferTx({
      sender: SENDER,
      recipientPubkey: RECIPIENT,
      contractId: TEST_CONTRACT,
      amount: 1000000n,
    })

    mockGetTransaction.mockResolvedValue(mockTxResult(tx))

    const store = Store.memory()
    const method = charge({
      recipient: RECIPIENT,
      currency: TEST_CONTRACT,
      store,
    })

    const credential = makeSignatureCredential({
      hash: 'replay-test-hash',
      amount: '1000000',
      currency: TEST_CONTRACT,
      recipient: RECIPIENT,
    })

    // First call succeeds
    await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    // Second call with same challenge ID should be rejected
    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Replay rejected')
  })
})
