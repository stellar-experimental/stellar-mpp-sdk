import { FeeBumpTransaction, Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import { DEFAULT_MAX_FEE_BUMP_STROOPS } from './defaults.js'

/**
 * Wraps a transaction in a `FeeBumpTransaction`.
 *
 * The inner transaction's source account and signatures remain intact — the
 * outer fee bump only overrides who pays the network fee at the protocol
 * level.
 *
 * Already-wrapped `FeeBumpTransaction` instances are returned unchanged.
 */
export function wrapFeeBump(
  tx: Transaction | FeeBumpTransaction,
  signer: Keypair,
  opts: {
    networkPassphrase: string
    maxFeeStroops?: number
  },
): Transaction | FeeBumpTransaction {
  if (tx instanceof FeeBumpTransaction) {
    return tx
  }

  const { networkPassphrase, maxFeeStroops = DEFAULT_MAX_FEE_BUMP_STROOPS } = opts
  const fee = Math.min(Number(tx.fee) * 10, maxFeeStroops).toString()

  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(signer, fee, tx, networkPassphrase)
  feeBumpTx.sign(signer)
  return feeBumpTx
}
