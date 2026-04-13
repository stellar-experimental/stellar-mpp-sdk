import { StellarMppError } from './errors.js'

export class SemaphoreTimeoutError extends StellarMppError {
  constructor() {
    super('Too many concurrent operations — try again later.')
    this.name = 'SemaphoreTimeoutError'
  }
}

/**
 * Counting semaphore with bounded queue and acquire timeout.
 *
 * Limits the number of concurrent long-running operations. Callers that
 * exceed the limit wait in a FIFO queue. If the queue is full or the
 * wait exceeds `acquireTimeoutMs`, the caller is rejected immediately
 * with a {@link SemaphoreTimeoutError}.
 */
export class Semaphore {
  private current = 0
  private readonly queue: { resolve: () => void; reject: (err: Error) => void }[] = []

  constructor(
    private readonly max: number,
    private readonly opts: { acquireTimeoutMs?: number; maxQueueSize?: number } = {},
  ) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return
    }

    const maxQueue = this.opts.maxQueueSize ?? this.max * 2
    if (this.queue.length >= maxQueue) {
      throw new SemaphoreTimeoutError()
    }

    const timeoutMs = this.opts.acquireTimeoutMs ?? 5_000

    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject }
      this.queue.push(entry)

      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry)
        if (idx !== -1) {
          this.queue.splice(idx, 1)
          reject(new SemaphoreTimeoutError())
        }
      }, timeoutMs)

      // Wrap resolve to clear the timer
      const origResolve = entry.resolve
      entry.resolve = () => {
        clearTimeout(timer)
        origResolve()
      }
    })
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next.resolve()
    } else {
      this.current--
    }
  }
}
