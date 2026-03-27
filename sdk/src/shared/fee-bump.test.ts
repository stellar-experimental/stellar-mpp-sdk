import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockSign = vi.fn()
const mockBuildFeeBumpTransaction = vi.fn()

class MockTransaction {
  fee: string
  constructor(fee: string) {
    this.fee = fee
  }
}

class MockFeeBumpTransaction {
  sign = mockSign
}

vi.mock('@stellar/stellar-sdk', () => ({
  Transaction: MockTransaction,
  FeeBumpTransaction: MockFeeBumpTransaction,
  Keypair: class {},
  TransactionBuilder: {
    buildFeeBumpTransaction: (...args: unknown[]) => mockBuildFeeBumpTransaction(...args),
  },
}))

const { wrapFeeBump } = await import('./fee-bump.js')

describe('wrapFeeBump', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps a Transaction in a FeeBumpTransaction signed by signer', () => {
    const tx = new MockTransaction('1000')
    const signer = {} as any
    const feeBumpTx = new MockFeeBumpTransaction()
    mockBuildFeeBumpTransaction.mockReturnValue(feeBumpTx)

    const result = wrapFeeBump(tx as any, signer, {
      networkPassphrase: 'Test SDF Network ; September 2015',
    })

    expect(mockBuildFeeBumpTransaction).toHaveBeenCalledWith(
      signer,
      '10000',
      tx,
      'Test SDF Network ; September 2015',
    )
    expect(feeBumpTx.sign).toHaveBeenCalledWith(signer)
    expect(result).toBe(feeBumpTx)
  })

  it('caps fee at maxFeeStroops when tx.fee * 10 exceeds it', () => {
    const tx = new MockTransaction('5000000')
    const signer = {} as any
    const feeBumpTx = new MockFeeBumpTransaction()
    mockBuildFeeBumpTransaction.mockReturnValue(feeBumpTx)

    wrapFeeBump(tx as any, signer, { networkPassphrase: 'Test' })

    // 5_000_000 * 10 = 50_000_000 > DEFAULT_MAX_FEE_BUMP_STROOPS (10_000_000)
    expect(mockBuildFeeBumpTransaction).toHaveBeenCalledWith(signer, '10000000', tx, 'Test')
  })

  it('skips wrapping if tx is already a FeeBumpTransaction', () => {
    const feeBumpTx = new MockFeeBumpTransaction()
    const signer = {} as any

    const result = wrapFeeBump(feeBumpTx as any, signer, { networkPassphrase: 'Test' })

    expect(result).toBe(feeBumpTx)
    expect(mockBuildFeeBumpTransaction).not.toHaveBeenCalled()
  })

  it('uses custom maxFeeStroops when provided', () => {
    const tx = new MockTransaction('1000')
    const signer = {} as any
    const feeBumpTx = new MockFeeBumpTransaction()
    mockBuildFeeBumpTransaction.mockReturnValue(feeBumpTx)

    wrapFeeBump(tx as any, signer, { networkPassphrase: 'Test', maxFeeStroops: 5000 })

    // 1000 * 10 = 10_000 > 5000, so capped at 5000
    expect(mockBuildFeeBumpTransaction).toHaveBeenCalledWith(signer, '5000', tx, 'Test')
  })

  it('requires networkPassphrase in opts', () => {
    const tx = new MockTransaction('1000')
    const signer = {} as any
    const feeBumpTx = new MockFeeBumpTransaction()
    mockBuildFeeBumpTransaction.mockReturnValue(feeBumpTx)

    // networkPassphrase is required — passing it works
    const result = wrapFeeBump(tx as any, signer, { networkPassphrase: 'Test' })
    expect(result).toBe(feeBumpTx)

    // TypeScript would catch a missing networkPassphrase at compile time,
    // but we verify the value is forwarded to buildFeeBumpTransaction
    expect(mockBuildFeeBumpTransaction).toHaveBeenCalledWith(signer, expect.any(String), tx, 'Test')
  })
})
