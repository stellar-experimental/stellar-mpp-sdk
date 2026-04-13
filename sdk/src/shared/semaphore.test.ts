import { describe, it, expect } from 'vitest'
import { Semaphore, SemaphoreTimeoutError } from './semaphore.js'

describe('Semaphore', () => {
  it('allows up to max concurrent acquisitions', async () => {
    const sem = new Semaphore(2)
    let running = 0
    let maxRunning = 0

    const task = async () => {
      await sem.acquire()
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
      sem.release()
    }

    await Promise.all([task(), task(), task(), task()])
    expect(maxRunning).toBe(2)
  })

  it('queues excess callers until a slot opens', async () => {
    const sem = new Semaphore(1)
    const order: number[] = []

    const task = async (id: number) => {
      await sem.acquire()
      order.push(id)
      await new Promise((r) => setTimeout(r, 10))
      sem.release()
    }

    await Promise.all([task(1), task(2), task(3)])
    expect(order).toEqual([1, 2, 3])
  })

  it('releases slot even when task throws', async () => {
    const sem = new Semaphore(1)

    try {
      await sem.acquire()
      throw new Error('boom')
    } catch {
      sem.release()
    }

    // Should not deadlock — acquire succeeds immediately
    await sem.acquire()
    sem.release()
  })
})

describe('Semaphore acquire timeout', () => {
  it('rejects with SemaphoreTimeoutError when acquire wait exceeds timeout', async () => {
    const sem = new Semaphore(1, { acquireTimeoutMs: 50 })

    await sem.acquire() // slot 1 taken

    // Second acquire should timeout
    await expect(sem.acquire()).rejects.toThrow(SemaphoreTimeoutError)

    sem.release()
  })

  it('resolves before timeout if a slot opens in time', async () => {
    const sem = new Semaphore(1, { acquireTimeoutMs: 200 })

    await sem.acquire()
    // Release after 30ms — well within the 200ms timeout
    setTimeout(() => sem.release(), 30)

    // Should resolve (not timeout)
    await sem.acquire()
    sem.release()
  })
})

describe('Semaphore queue size limit', () => {
  it('rejects immediately when queue is full', async () => {
    const sem = new Semaphore(1, { maxQueueSize: 1 })

    await sem.acquire() // slot taken

    // First queued caller is fine
    const queued = sem.acquire()

    // Second queued caller exceeds maxQueueSize=1 → immediate reject
    await expect(sem.acquire()).rejects.toThrow(SemaphoreTimeoutError)

    sem.release() // unblock the first queued caller
    await queued
    sem.release()
  })

  it('defaults maxQueueSize to 2x max', async () => {
    const sem = new Semaphore(2) // default maxQueueSize = 4

    await sem.acquire()
    await sem.acquire() // both slots taken

    // Queue 4 callers (2x max)
    const q1 = sem.acquire()
    const q2 = sem.acquire()
    const q3 = sem.acquire()
    const q4 = sem.acquire()

    // 5th queued caller exceeds default limit
    await expect(sem.acquire()).rejects.toThrow(SemaphoreTimeoutError)

    // Cleanup
    sem.release()
    sem.release()
    await q1
    sem.release()
    await q2
    sem.release()
    await q3
    sem.release()
    await q4
    sem.release()
  })
})
