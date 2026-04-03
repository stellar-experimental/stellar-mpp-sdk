import type { Store } from 'mppx'

/**
 * Process-local claim registry backed by a synchronous Set.
 *
 * Prevents intra-process TOCTOU races on store get→put sequences.
 * Two coroutines sharing the same store cannot both pass the
 * synchronous check because Set.has/add are not interruptible.
 *
 * For cross-process safety, callers must still write to the backing
 * store immediately after claiming.
 */
const claimSets = new WeakMap<Store.Store, Set<string>>()

function getSet(store: Store.Store): Set<string> {
  let set = claimSets.get(store)
  if (!set) {
    set = new Set()
    claimSets.set(store, set)
  }
  return set
}

/**
 * Synchronously claims a key. Throws `error` if already claimed
 * (by this process) or present in the store.
 *
 * After calling this, write to the store immediately, then call
 * {@link releaseClaim} to free the in-memory slot (the store
 * entry becomes authoritative for cross-process protection).
 */
export function claimOrThrow(store: Store.Store, key: string, error: Error): void {
  const set = getSet(store)
  if (set.has(key)) throw error
  set.add(key)
}

/**
 * Releases a previously claimed key from the in-memory Set.
 * Call after the store entry is written (the store becomes
 * authoritative) or when the claim must be rolled back.
 */
export function releaseClaim(store: Store.Store, key: string): void {
  claimSets.get(store)?.delete(key)
}
