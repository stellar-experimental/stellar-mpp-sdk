import { type FeeBumpTransaction, type Transaction, rpc } from '@stellar/stellar-sdk'

const DEFAULT_ATTEMPTS = 60
const SLEEP_STRATEGY = rpc.BasicSleepStrategy
const SEND_RETRY_DELAY_MS = 2000

/**
 * Submit a transaction, handling status responses:
 * - PENDING / DUPLICATE: return the hash for polling
 * - TRY_AGAIN_LATER: retry once after a delay
 * - ERROR: throw immediately
 */
export async function sendTx(
  server: rpc.Server,
  tx: Transaction | FeeBumpTransaction,
): Promise<string> {
  let result = await server.sendTransaction(tx)

  if (result.status === 'TRY_AGAIN_LATER') {
    await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS))
    result = await server.sendTransaction(tx)
  }

  if (result.status === 'ERROR') {
    throw new Error(`Transaction rejected: ${result.errorResult?.result()?.switch().name ?? result.status}`)
  }

  // PENDING or DUPLICATE — both mean the hash is valid for polling
  return result.hash
}

/**
 * Poll for a transaction result using the SDK's built-in pollTransaction
 * with exponential backoff. Shared by all tx submission sites.
 */
export async function pollTx(
  server: rpc.Server,
  hash: string,
  attempts: number = DEFAULT_ATTEMPTS,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const result = await server.pollTransaction(hash, {
    attempts,
    sleepStrategy: SLEEP_STRATEGY,
  })

  if (result.status !== 'SUCCESS') {
    throw new Error(
      `Transaction failed: ${result.status}`,
    )
  }

  return result as rpc.Api.GetSuccessfulTransactionResponse
}
