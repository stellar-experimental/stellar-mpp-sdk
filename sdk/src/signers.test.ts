import { describe, expect, it } from 'vitest'
import { resolveKeypair } from './signers.js'
import { Keypair } from '@stellar/stellar-sdk'

describe('resolveKeypair', () => {
  it('passes through a Keypair', () => {
    const kp = Keypair.random()
    expect(resolveKeypair(kp).publicKey()).toBe(kp.publicKey())
  })

  it('converts a secret key string', () => {
    const kp = Keypair.random()
    expect(resolveKeypair(kp.secret()).publicKey()).toBe(kp.publicKey())
  })
})
