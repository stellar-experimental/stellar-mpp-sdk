import { FeeBumpTransaction, Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import { DEFAULT_MAX_FEE_BUMP_STROOPS } from './defaults.js'

export interface FeeBumpOptions {
  networkPassphrase: string
  maxFeeStroops?: number
}

export function wrapFeeBump(
  tx: Transaction | FeeBumpTransaction,
  signer: Keypair,
  opts: FeeBumpOptions,
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
