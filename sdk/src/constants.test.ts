import { describe, expect, it } from 'vitest'
import * as constants from './constants.js'

describe('constants', () => {
  it('exports NETWORK_PASSPHRASE for public and testnet', () => {
    expect(constants.NETWORK_PASSPHRASE.public).toBe(
      'Public Global Stellar Network ; September 2015',
    )
    expect(constants.NETWORK_PASSPHRASE.testnet).toBe(
      'Test SDF Network ; September 2015',
    )
  })

  it('exports SOROBAN_RPC_URLS', () => {
    expect(constants.SOROBAN_RPC_URLS.public).toMatch(/^https:\/\//)
    expect(constants.SOROBAN_RPC_URLS.testnet).toMatch(/^https:\/\//)
  })

  it('exports HORIZON_URLS', () => {
    expect(constants.HORIZON_URLS.public).toBe('https://horizon.stellar.org')
    expect(constants.HORIZON_URLS.testnet).toBe(
      'https://horizon-testnet.stellar.org',
    )
  })

  it('exports USDC SAC contract addresses', () => {
    expect(constants.USDC_SAC_MAINNET).toMatch(/^C/)
    expect(constants.USDC_SAC_TESTNET).toMatch(/^C/)
  })

  it('exports XLM SAC contract addresses', () => {
    expect(constants.XLM_SAC_MAINNET).toMatch(/^C/)
    expect(constants.XLM_SAC_TESTNET).toMatch(/^C/)
  })

  it('exports SAC_ADDRESSES map', () => {
    expect(constants.SAC_ADDRESSES.public.USDC).toBe(constants.USDC_SAC_MAINNET)
    expect(constants.SAC_ADDRESSES.testnet.USDC).toBe(constants.USDC_SAC_TESTNET)
    expect(constants.SAC_ADDRESSES.public.XLM).toBe(constants.XLM_SAC_MAINNET)
    expect(constants.SAC_ADDRESSES.testnet.XLM).toBe(constants.XLM_SAC_TESTNET)
  })

  it('exports DEFAULT_DECIMALS as 7', () => {
    expect(constants.DEFAULT_DECIMALS).toBe(7)
  })
})
