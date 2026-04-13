import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockSimulateTransaction = vi.fn()
const mockIsSimulationSuccess = vi.fn()
const mockIsSimulationError = vi.fn()

vi.mock('@stellar/stellar-sdk', () => ({
  FeeBumpTransaction: class {},
  Transaction: class {},
  rpc: {
    Api: {
      isSimulationSuccess: (...args: unknown[]) => mockIsSimulationSuccess(...args),
      isSimulationError: (...args: unknown[]) => mockIsSimulationError(...args),
    },
  },
}))

const { simulateCall, SimulationContractError, SimulationNetworkError, SimulationTimeoutError } =
  await import('./simulate.js')

const rpcServer = { simulateTransaction: mockSimulateTransaction } as any

describe('simulateCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns simulation result on success', async () => {
    const simResult = { id: 'sim-1', result: { retval: 'ok' } }
    mockSimulateTransaction.mockResolvedValue(simResult)
    mockIsSimulationSuccess.mockReturnValue(true)

    const result = await simulateCall(rpcServer, {} as any)

    expect(result).toBe(simResult)
    expect(mockSimulateTransaction).toHaveBeenCalledOnce()
    expect(mockIsSimulationSuccess).toHaveBeenCalledWith(simResult)
  })

  it('throws SimulationContractError when simulation has error field', async () => {
    const simResult = { error: 'contract invocation failed' }
    mockSimulateTransaction.mockResolvedValue(simResult)
    mockIsSimulationSuccess.mockReturnValue(false)
    mockIsSimulationError.mockReturnValue(true)

    const err = await simulateCall(rpcServer, {} as any).catch((e) => e)
    expect(err).toBeInstanceOf(SimulationContractError)
    expect(err.message).toMatch(/contract invocation failed/)
    expect(err.simulationError).toBe('contract invocation failed')
  })

  it('throws SimulationContractError with unknown error when not a recognized error response', async () => {
    const simResult = { id: 'sim-restore' }
    mockSimulateTransaction.mockResolvedValue(simResult)
    mockIsSimulationSuccess.mockReturnValue(false)
    mockIsSimulationError.mockReturnValue(false)

    const err = await simulateCall(rpcServer, {} as any).catch((e) => e)
    expect(err).toBeInstanceOf(SimulationContractError)
    expect(err.simulationError).toBe('unknown error')
  })

  it('throws SimulationNetworkError when RPC call throws', async () => {
    mockSimulateTransaction.mockRejectedValue(new Error('ECONNREFUSED'))

    const err = await simulateCall(rpcServer, {} as any).catch((e) => e)
    expect(err).toBeInstanceOf(SimulationNetworkError)
    expect(err.message).toMatch(/ECONNREFUSED/)
  })

  it('throws SimulationTimeoutError when simulation exceeds timeout', async () => {
    vi.useFakeTimers()

    mockSimulateTransaction.mockImplementation(
      () => new Promise(() => {}), // never resolves
    )

    const promise = simulateCall(rpcServer, {} as any, { timeoutMs: 100 }).catch((e) => e)

    await vi.advanceTimersByTimeAsync(100)

    const err = await promise
    expect(err).toBeInstanceOf(SimulationTimeoutError)
    expect(err.message).toMatch(/timed out after 100ms/)

    vi.useRealTimers()
  })
})
