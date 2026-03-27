import { Keypair } from '@stellar/stellar-sdk'

/**
 * Resolve a single keypair from a Keypair or secret key string.
 */
export function resolveKeypair(input: Keypair | string): Keypair {
  return typeof input === 'string' ? Keypair.fromSecret(input) : input
}
