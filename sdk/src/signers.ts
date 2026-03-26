import { Keypair } from '@stellar/stellar-sdk'

/**
 * Input type for signer configuration. Accepts a single keypair/secret
 * or an array of keypairs/secrets.
 */
export type SignerPool = Keypair | string | (Keypair | string)[]

/**
 * Creates a round-robin signer selector. Each call returns the next
 * address in the array, wrapping around at the end.
 */
export function roundRobinSelector(): (addresses: readonly string[]) => string {
  let index = 0
  return (addresses) => addresses[index++ % addresses.length]
}

/**
 * Normalize a `SignerPool` into an array of Keypairs.
 */
export function resolveSigners(pool: SignerPool): Keypair[] {
  const items = Array.isArray(pool) ? pool : [pool]
  return items.map((item) =>
    typeof item === 'string' ? Keypair.fromSecret(item) : item,
  )
}

/**
 * Resolve a single keypair from a Keypair or secret key string.
 */
export function resolveKeypair(input: Keypair | string): Keypair {
  return typeof input === 'string' ? Keypair.fromSecret(input) : input
}
