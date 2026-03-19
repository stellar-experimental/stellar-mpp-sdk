import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { Challenge, Credential, Store } from 'mppx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NETWORK_PASSPHRASE } from '../constants.js'
import { USDC_SAC_TESTNET } from '../constants.js'

const mockGetAccount = vi.fn()
const mockGetTransaction = vi.fn()
const mockSendTransaction = vi.fn()

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        getTransaction: mockGetTransaction,
        sendTransaction: mockSendTransaction,
      })),
    },
  }
})

const { charge } = await import('./Charge.js')

const RECIPIENT = Keypair.random().publicKey()
const SENDER = Keypair.random()

afterEach(() => {
  vi.clearAllMocks()
})

function makeCredential(payload: { type: 'signature'; hash: string } | { type: 'transaction'; xdr: string }) {
  const challenge = Challenge.from({
    id: `test-${crypto.randomUUID()}`,
    realm: 'localhost',
    method: 'stellar',
    intent: 'charge',
    request: {
      amount: '1000000',
      currency: USDC_SAC_TESTNET,
      recipient: RECIPIENT,
      methodDetails: {
        network: 'testnet',
        reference: crypto.randomUUID(),
      },
    },
  })

  return Credential.from({ challenge, payload })
}

function mockAccount(accountId = SENDER.publicKey()) {
  mockGetAccount.mockResolvedValue({
    accountId: () => accountId,
    sequenceNumber: () => '0',
    sequence: () => '0',
    incrementSequenceNumber: () => {},
  })
}

function buildTransferTransaction(options?: {
  amount?: bigint
  currency?: string
  recipient?: string
}) {
  const contract = new Contract(options?.currency ?? USDC_SAC_TESTNET)
  const tx = new TransactionBuilder(
    {
      accountId: () => SENDER.publicKey(),
      sequenceNumber: () => '0',
      sequence: () => '0',
      incrementSequenceNumber: () => {},
    },
    {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE.testnet,
    },
  )
    .addOperation(
      contract.call(
        'transfer',
        new Address(SENDER.publicKey()).toScVal(),
        new Address(options?.recipient ?? RECIPIENT).toScVal(),
        nativeToScVal(options?.amount ?? 1000000n, { type: 'i128' }),
      ),
    )
    .setTimeout(30)
    .build()

  return tx
}

function createDelayedStore() {
  const values = new Map<string, unknown>()

  return {
    async get(key: string) {
      if (key.startsWith('stellar:challenge:')) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return values.has(key) ? (values.get(key) as unknown) : null
    },
    async put(key: string, value: unknown) {
      values.set(key, value)
    },
    async delete(key: string) {
      values.delete(key)
    },
  }
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
  it('rejects signature payload when envelopeXdr is missing', async () => {
    mockGetTransaction.mockResolvedValueOnce({ status: 'SUCCESS' })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })

    const credential = makeCredential({
      type: 'signature',
      hash: 'abc123',
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Transaction envelope is missing')
  })

  it('rejects signature payload when transfer details do not match', async () => {
    const tx = buildTransferTransaction({ recipient: Keypair.random().publicKey() })
    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })

    const credential = makeCredential({
      type: 'signature',
      hash: 'abc123',
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('matching SAC transfer invocation')
  })

  it('rejects malformed transaction XDR', async () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })

    const credential = makeCredential({
      type: 'transaction',
      xdr: 'not-xdr',
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Credential transaction XDR is invalid')
  })

  it('accepts valid signature payload with matching SAC transfer', async () => {
    const tx = buildTransferTransaction()
    mockGetTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })

    const credential = makeCredential({
      type: 'signature',
      hash: 'abc123',
    })

    const receipt = await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    expect(receipt.status).toBe('success')
  })

  it('rejects replay of the same challenge ID when store is configured', async () => {
    const tx = buildTransferTransaction()
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const store = Store.memory()
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store,
    })

    const credential = makeCredential({
      type: 'signature',
      hash: 'abc123',
    })

    await method.verify({
      credential: credential as any,
      request: credential.challenge.request,
    })

    await expect(
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ).rejects.toThrow('Replay rejected')
  })

  it('serializes concurrent verification of the same challenge in-process', async () => {
    const tx = buildTransferTransaction()
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      envelopeXdr: tx.toXDR(),
    })

    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store: createDelayedStore() as Store.Store,
    })

    const credential = makeCredential({
      type: 'signature',
      hash: 'abc123',
    })

    const results = await Promise.allSettled([
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
      method.verify({
        credential: credential as any,
        request: credential.challenge.request,
      }),
    ])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason.message).toContain(
      'Replay rejected',
    )
  })
})
