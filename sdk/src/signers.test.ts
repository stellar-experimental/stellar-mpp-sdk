import { describe, expect, it } from 'vitest'
import { roundRobinSelector, resolveSigners, resolveKeypair } from './signers.js'
import { Keypair } from '@stellar/stellar-sdk'

describe('roundRobinSelector', () => {
  it('cycles through addresses', () => {
    const select = roundRobinSelector()
    const addrs = ['GA...1', 'GA...2', 'GA...3'] as const
    expect(select(addrs)).toBe('GA...1')
    expect(select(addrs)).toBe('GA...2')
    expect(select(addrs)).toBe('GA...3')
    expect(select(addrs)).toBe('GA...1')
  })

  it('works with a single address', () => {
    const select = roundRobinSelector()
    const addrs = ['GA...1'] as const
    expect(select(addrs)).toBe('GA...1')
    expect(select(addrs)).toBe('GA...1')
  })
})

describe('resolveSigners', () => {
  it('accepts a single Keypair', () => {
    const kp = Keypair.random()
    const result = resolveSigners(kp)
    expect(result.length).toBe(1)
    expect(result[0].publicKey()).toBe(kp.publicKey())
  })

  it('accepts a single secret key string', () => {
    const kp = Keypair.random()
    const result = resolveSigners(kp.secret())
    expect(result.length).toBe(1)
    expect(result[0].publicKey()).toBe(kp.publicKey())
  })

  it('accepts an array of mixed Keypair and string', () => {
    const kp1 = Keypair.random()
    const kp2 = Keypair.random()
    const result = resolveSigners([kp1, kp2.secret()])
    expect(result.length).toBe(2)
    expect(result[0].publicKey()).toBe(kp1.publicKey())
    expect(result[1].publicKey()).toBe(kp2.publicKey())
  })
})

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
