import { rpc } from '@stellar/stellar-sdk'
import { DEFAULT_SIMULATION_TIMEOUT_MS } from './defaults.js'

export class SimulationContractError extends Error {
  constructor(
    message: string,
    public readonly simulationError: string,
  ) {
    super(message)
    this.name = 'SimulationContractError'
  }
}

export class SimulationNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message)
    this.name = 'SimulationNetworkError'
  }
}

export class SimulationTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimulationTimeoutError'
  }
}

export interface SimulateOptions {
  timeoutMs?: number
}

export async function simulateCall(
  rpcServer: rpc.Server,
  tx: unknown,
  opts: SimulateOptions = {},
): Promise<rpc.Api.SimulateTransactionResponse> {
  const { timeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS } = opts

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      rpcServer.simulateTransaction(tx as any),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SimulationTimeoutError(`Simulation timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
    clearTimeout(timer)

    if (!rpc.Api.isSimulationSuccess(result)) {
      const errorMsg = 'error' in result ? String((result as any).error) : 'unknown error'
      throw new SimulationContractError(`Simulation failed: ${errorMsg}`, errorMsg)
    }

    return result
  } catch (err) {
    if (err instanceof SimulationContractError || err instanceof SimulationTimeoutError) {
      throw err
    }
    throw new SimulationNetworkError(
      `Simulation network error: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }
}
