import { Keypair } from '@stellar/stellar-sdk'
import { Store } from 'mppx'
import { describe, expect, it } from 'vitest'
import { USDC_SAC_TESTNET } from '../constants.js'
import { charge } from './Charge.js'

const RECIPIENT = Keypair.random().publicKey()

describe('stellar server charge', () => {
  it('creates a server method with correct name and intent', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })
    expect(method.name).toBe('stellar')
    expect(method.intent).toBe('charge')
  })

  it('has a verify function', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
    })
    expect(typeof method.verify).toBe('function')
  })

  it('accepts store for replay protection', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      store: Store.memory(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom network', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      network: 'public',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom rpcUrl', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      rpcUrl: 'https://custom.rpc.example.com',
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feePayer as secret key string', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: Keypair.random().secret(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts feePayer as Keypair', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      feePayer: Keypair.random(),
    })
    expect(method.name).toBe('stellar')
  })

  it('accepts custom decimals', () => {
    const method = charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
      decimals: 6,
    })
    expect(method.name).toBe('stellar')
  })
})
