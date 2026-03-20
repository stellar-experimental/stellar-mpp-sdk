import {
  Address,
  Contract,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import {
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../../constants.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelState = {
  /** Current token balance held in the channel contract. */
  balance: bigint
  /** The refund waiting period in ledgers. */
  refundWaitingPeriod: number
  /** Token contract address. */
  token: string
  /** Funder address. */
  from: string
  /** Recipient address. */
  to: string
  /**
   * If set, the ledger sequence at which close becomes effective. This means
   * either `close_start` has been called (dispute) or `close` has settled.
   * If the current ledger is past this value, the funder can call `refund`.
   */
  closeEffectiveAtLedger: number | null
  /** Current ledger sequence at the time of the query. */
  currentLedger: number
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Query the on-chain state of a one-way payment channel contract.
 *
 * This calls the contract's public getter functions via simulation
 * (no transaction fees) and reads instance storage for dispute status.
 *
 * @example
 * ```ts
 * import { getChannelState } from 'stellar-mpp-sdk/channel/server'
 *
 * const state = await getChannelState({
 *   channel: 'CABC...',
 *   sourceAccount: 'GABC...',
 * })
 *
 * if (state.closeEffectiveAtLedger != null) {
 *   console.log('Channel is closing/closed!')
 * }
 * ```
 */
export async function getChannelState(
  parameters: getChannelState.Parameters,
): Promise<ChannelState> {
  const {
    channel: channelAddress,
    network = 'testnet',
    rpcUrl,
    sourceAccount,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const networkPassphrase = NETWORK_PASSPHRASE[network]
  const server = new rpc.Server(resolvedRpcUrl)

  const contract = new Contract(channelAddress)
  const account = await server.getAccount(sourceAccount)

  async function simulateGetter(fnName: string, ...args: xdr.ScVal[]) {
    const call = contract.call(fnName, ...args)
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(call)
      .setTimeout(30)
      .build()

    const result = await server.simulateTransaction(tx)
    if (!rpc.Api.isSimulationSuccess(result)) {
      const errorMsg =
        'error' in result ? String(result.error) : 'unknown'
      throw new Error(
        `Failed to simulate ${fnName} on channel ${channelAddress}: ${errorMsg}`,
      )
    }
    return result.result?.retval
  }

  // Run getter simulations in parallel
  const [balanceVal, waitingPeriodVal, tokenVal, fromVal, toVal] =
    await Promise.all([
      simulateGetter('balance'),
      simulateGetter('refund_waiting_period'),
      simulateGetter('token'),
      simulateGetter('from'),
      simulateGetter('to'),
    ])

  const balance = scValToI128(balanceVal!)
  if (!waitingPeriodVal) {
    throw new Error(
      `Failed to simulate refund_waiting_period on channel ${channelAddress}: missing return value`,
    )
  }
  const refundWaitingPeriod = waitingPeriodVal.u32()
  const token = Address.fromScVal(tokenVal!).toString()
  const from = Address.fromScVal(fromVal!).toString()
  const to = Address.fromScVal(toVal!).toString()

  // Read CloseEffectiveAtLedger from contract instance storage.
  // The contract uses DataKey::CloseEffectiveAtLedger (enum variant index 5)
  // stored in instance storage.
  const closeEffectiveAtLedger = await readCloseEffectiveAtLedger(
    server,
    channelAddress,
  )

  const latestLedger = await server.getLatestLedger()

  return {
    balance,
    refundWaitingPeriod,
    token,
    from,
    to,
    closeEffectiveAtLedger,
    currentLedger: latestLedger.sequence,
  }
}

export declare namespace getChannelState {
  type Parameters = {
    /** Channel contract address (C...). */
    channel: string
    /** Stellar network. @default 'testnet' */
    network?: NetworkId
    /** Custom Soroban RPC URL. */
    rpcUrl?: string
    /** Funded Stellar account address (G...) used as the source for simulations. */
    sourceAccount: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the CloseEffectiveAtLedger entry from the contract's instance storage.
 *
 * The contract's `DataKey` enum:
 * ```rust
 * enum DataKey { Token, From, CommitmentKey, To, RefundWaitingPeriod, CloseEffectiveAtLedger }
 * ```
 * Each variant is encoded as `ScVal::Vec([ScVal::Symbol(variant_name)])` in Soroban
 * for enum variants without data.
 *
 * We look for the `CloseEffectiveAtLedger` key in the contract's instance storage.
 */
async function readCloseEffectiveAtLedger(
  server: rpc.Server,
  channelAddress: string,
): Promise<number | null> {
  try {
    // Build the LedgerKey for the contract's instance entry
    const contractId = Address.fromString(channelAddress)
    const instanceKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: contractId.toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    )

    const response = await server.getLedgerEntries(instanceKey)
    if (!response.entries || response.entries.length === 0) {
      return null
    }

    const entry = response.entries[0]
    const contractData = entry.val.contractData()
    const instance = contractData.val().instance()
    const storage = instance.storage()

    if (!storage) return null

    // Search for the CloseEffectiveAtLedger key in the instance storage map.
    // Soroban encodes simple enum variants as ScVal::Vec([ScVal::Symbol(name)])
    for (const entry of storage) {
      const key = entry.key()
      // Check if this key matches DataKey::CloseEffectiveAtLedger
      if (isEnumVariant(key, 'CloseEffectiveAtLedger')) {
        const val = entry.val()
        return val.u32()
      }
    }

    return null
  } catch {
    return null
  }
}

/** Check if an ScVal is a Soroban enum variant with the given name. */
function isEnumVariant(scVal: xdr.ScVal, name: string): boolean {
  try {
    if (scVal.switch().value === xdr.ScValType.scvVec().value) {
      const vec = scVal.vec()!
      if (
        vec.length === 1 &&
        vec[0].switch().value === xdr.ScValType.scvSymbol().value
      ) {
        return vec[0].sym().toString() === name
      }
    }
  } catch {
    // not the shape we expected
  }
  return false
}

function scValToI128(val: xdr.ScVal): bigint {
  const i128 = val.i128()
  const hi = BigInt(i128.hi().toString())
  const lo = BigInt(i128.lo().toString())
  return (hi << 64n) | lo
}
