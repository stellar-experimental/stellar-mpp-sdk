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
export const USDC_SAC_MAINNET =
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI'

/** USDC SAC contract address on Stellar testnet. */
export const USDC_SAC_TESTNET =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'

/** Native XLM SAC contract address on mainnet. */
export const XLM_SAC_MAINNET =
  'CAS3J7GYLGVE45MR3HPSFG352DAANEV5GGMFTO3IZIE4JMCDALQO57Y'

/** Native XLM SAC contract address on testnet. */
export const XLM_SAC_TESTNET =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

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
// Defaults
// ---------------------------------------------------------------------------

/** Default number of decimal places for Stellar assets. */
export const DEFAULT_DECIMALS = 7

/** Default fee in stroops. */
export const DEFAULT_FEE = '100'

/** Default transaction timeout in seconds. */
export const DEFAULT_TIMEOUT = 180
