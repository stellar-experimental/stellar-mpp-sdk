import { Networks } from '@stellar/stellar-sdk'

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

export const NETWORK_PASSPHRASE = {
  public: Networks.PUBLIC,
  testnet: Networks.TESTNET,
} as const

export type NetworkId = keyof typeof NETWORK_PASSPHRASE

// ---------------------------------------------------------------------------
// RPC / Horizon URLs
// ---------------------------------------------------------------------------

export const SOROBAN_RPC_URLS: Record<NetworkId, string> = {
  public: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
  testnet: 'https://soroban-testnet.stellar.org',
}

export const HORIZON_URLS: Record<NetworkId, string> = {
  public: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
}

// ---------------------------------------------------------------------------
// USDC Stellar Asset Contract (SAC) addresses
// ---------------------------------------------------------------------------

/** USDC SAC contract address on Stellar mainnet. */
export const USDC_SAC_MAINNET = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI'

/** USDC SAC contract address on Stellar testnet. */
export const USDC_SAC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'

/** Native XLM SAC contract address on mainnet. */
export const XLM_SAC_MAINNET = 'CAS3J7GYLGVE45MR3HPSFG352DAANEV5GGMFTO3IZIE4JMCDALQO57Y'

/** Native XLM SAC contract address on testnet. */
export const XLM_SAC_TESTNET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

/** Map from network to well-known SAC addresses. */
export const SAC_ADDRESSES = {
  public: {
    USDC: USDC_SAC_MAINNET,
    XLM: XLM_SAC_MAINNET,
  },
  testnet: {
    USDC: USDC_SAC_TESTNET,
    XLM: XLM_SAC_TESTNET,
  },
} as const

// ---------------------------------------------------------------------------
// CAIP-2 network identifiers
// ---------------------------------------------------------------------------

/**
 * Maps internal network IDs to CAIP-2 chain identifiers.
 * @see https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
 */
export const CAIP2_NETWORK: Record<NetworkId, string> = {
  public: 'stellar:pubnet',
  testnet: 'stellar:testnet',
}

/**
 * Reverse map: CAIP-2 chain identifier → internal NetworkId.
 */
export const CAIP2_TO_NETWORK: Record<string, NetworkId> = {
  'stellar:pubnet': 'public',
  'stellar:testnet': 'testnet',
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default number of decimal places for Stellar assets. */
export const DEFAULT_DECIMALS = 7

/** Default fee in stroops. */
export const DEFAULT_FEE = '100'

/** Default transaction timeout in seconds. */
export const DEFAULT_TIMEOUT = 180

/** Average Stellar ledger close time in seconds. */
export const DEFAULT_LEDGER_CLOSE_TIME = 5

/** Default challenge expiry in seconds (5 minutes). */
export const DEFAULT_CHALLENGE_EXPIRY = 300

// ---------------------------------------------------------------------------
// Special accounts
// ---------------------------------------------------------------------------

/**
 * All-zeros Stellar source account (`GAAA...WHF`).
 *
 * Used in the spec-compliant sponsored charge flow: the client sets this as
 * the transaction source so the server can substitute its own fee-payer
 * account when rebuilding the transaction.
 */
export const ALL_ZEROS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
