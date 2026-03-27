import {
  DEFAULT_POLL_MAX_ATTEMPTS,
  DEFAULT_POLL_DELAY_MS,
  DEFAULT_POLL_BACKOFF_MULTIPLIER,
  DEFAULT_POLL_JITTER_MS,
  DEFAULT_POLL_TIMEOUT_MS,
} from './defaults.js'
import { StellarMppError } from './errors.js'

export class PollTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PollTimeoutError'
  }
}

export class PollMaxAttemptsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PollMaxAttemptsError'
  }
}

export interface PollOptions {
  maxAttempts?: number
  delayMs?: number
  backoffMultiplier?: number
  jitterMs?: number
  timeoutMs?: number
}

export async function pollTransaction(
  rpcServer: { getTransaction(hash: string): Promise<any> },
  hash: string,
  opts: PollOptions = {},
) {
  const {
    maxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    delayMs = DEFAULT_POLL_DELAY_MS,
    backoffMultiplier = DEFAULT_POLL_BACKOFF_MULTIPLIER,
    jitterMs = DEFAULT_POLL_JITTER_MS,
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  } = opts

  const startTime = Date.now()
  let attempts = 0

  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      throw new PollTimeoutError(`Poll timed out after ${timeoutMs}ms for transaction ${hash}`)
    }

    const result = await rpcServer.getTransaction(hash)

    if (result.status === 'SUCCESS') {
      return result
    }

    if (result.status === 'FAILED') {
      throw new StellarMppError(
        `Transaction ${hash} failed: ${result.resultXdr ?? 'unknown error'}`,
      )
    }

    attempts++
    if (attempts >= maxAttempts) {
      throw new PollMaxAttemptsError(`Transaction ${hash} not found after ${maxAttempts} attempts`)
    }

    const baseDelay = delayMs * Math.pow(backoffMultiplier, attempts - 1)
    const jitter = (Math.random() * 2 - 1) * jitterMs
    const delay = Math.max(0, baseDelay + jitter)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}
