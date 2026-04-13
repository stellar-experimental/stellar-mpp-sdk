import { Store } from 'mppx'
import { describe, expect, it } from 'vitest'
import { claimOrThrow, releaseClaim } from './claim.js'

describe('claimOrThrow', () => {
  it('succeeds on first claim for a key', () => {
    const store = Store.memory()
    expect(() => claimOrThrow(store, 'key-a', new Error('taken'))).not.toThrow()
  })

  it('throws on duplicate claim for the same key', () => {
    const store = Store.memory()
    claimOrThrow(store, 'key-b', new Error('first'))
    expect(() => claimOrThrow(store, 'key-b', new Error('duplicate'))).toThrow('duplicate')
  })

  it('throws the exact error instance provided', () => {
    const store = Store.memory()
    claimOrThrow(store, 'key-c', new Error('first'))
    const err = new TypeError('custom error')
    expect(() => claimOrThrow(store, 'key-c', err)).toThrow(err)
  })

  it('allows different keys on the same store', () => {
    const store = Store.memory()
    claimOrThrow(store, 'key-1', new Error('taken'))
    expect(() => claimOrThrow(store, 'key-2', new Error('taken'))).not.toThrow()
  })

  it('isolates claims between separate store instances', () => {
    const storeA = Store.memory()
    const storeB = Store.memory()
    claimOrThrow(storeA, 'shared-key', new Error('taken'))
    expect(() => claimOrThrow(storeB, 'shared-key', new Error('taken'))).not.toThrow()
  })
})

describe('releaseClaim', () => {
  it('allows re-claiming a key after release', () => {
    const store = Store.memory()
    claimOrThrow(store, 'key-r', new Error('taken'))
    releaseClaim(store, 'key-r')
    expect(() => claimOrThrow(store, 'key-r', new Error('taken'))).not.toThrow()
  })

  it('is a no-op for an unclaimed key', () => {
    const store = Store.memory()
    expect(() => releaseClaim(store, 'nonexistent')).not.toThrow()
  })

  it('is a no-op for a store with no claims', () => {
    const store = Store.memory()
    expect(() => releaseClaim(store, 'anything')).not.toThrow()
  })

  it('does not affect other keys on the same store', () => {
    const store = Store.memory()
    claimOrThrow(store, 'key-x', new Error('taken'))
    claimOrThrow(store, 'key-y', new Error('taken'))
    releaseClaim(store, 'key-x')

    // key-x is free, key-y is still claimed
    expect(() => claimOrThrow(store, 'key-x', new Error('taken'))).not.toThrow()
    expect(() => claimOrThrow(store, 'key-y', new Error('taken'))).toThrow('taken')
  })
})

describe('concurrent claim prevention', () => {
  it('only one of N synchronous claimOrThrow calls succeeds', () => {
    const store = Store.memory()
    const key = 'race-key'
    let successes = 0
    let failures = 0

    for (let i = 0; i < 10; i++) {
      try {
        claimOrThrow(store, key, new Error('taken'))
        successes++
      } catch {
        failures++
      }
    }

    expect(successes).toBe(1)
    expect(failures).toBe(9)
  })

  it('prevents interleaved async coroutines from both claiming', async () => {
    // Simulates two coroutines that would both pass an async store.get
    // check, but the synchronous claimOrThrow blocks the second one.
    const store = Store.memory()
    const key = 'async-race'

    async function claimAndWork() {
      claimOrThrow(store, key, new Error('taken'))
      // Simulate async gap (store.get, store.put, RPC, etc.)
      await new Promise((r) => setTimeout(r, 10))
      releaseClaim(store, key)
    }

    const results = await Promise.allSettled([claimAndWork(), claimAndWork()])
    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
  })
})
