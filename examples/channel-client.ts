/**
 * Example: Stellar MPP Channel Client
 *
 * Automatically handles 402 Payment Required responses by signing
 * off-chain commitment updates — no on-chain transaction per payment.
 *
 * Usage:
 *   COMMITMENT_SECRET=73b5... npx tsx examples/channel-client.ts
 */

import { Keypair } from '@stellar/stellar-sdk'
import { Mppx } from 'mppx/client'
import { stellar } from '../sdk/src/channel/client/index.js'

const commitmentSecret = process.env.COMMITMENT_SECRET
if (!commitmentSecret || commitmentSecret.length !== 64) {
  console.error('Usage: COMMITMENT_SECRET=<64-char-hex-ed25519-secret> npx tsx examples/channel-client.ts')
  process.exit(1)
}

// Convert the raw ed25519 secret key (hex) to a Stellar Keypair for signing
const commitmentKey = Keypair.fromRawEd25519Seed(Buffer.from(commitmentSecret, 'hex'))
console.log(`Using commitment key: ${commitmentKey.publicKey()}`)

// Polyfill global fetch with automatic 402 handling
Mppx.create({
  methods: [
    stellar.channel({
      commitmentKey,
      sourceAccount: process.env.SOURCE_ACCOUNT,
      onProgress(event) {
        const ts = new Date().toISOString().slice(11, 23)
        switch (event.type) {
          case 'challenge':
            console.log(`[${ts}] 💳 Challenge received — ${event.amount} stroops via channel ${event.channel.slice(0, 12)}...`)
            console.log(`[${ts}]    Cumulative amount will be: ${event.cumulativeAmount} stroops`)
            break
          case 'signing':
            console.log(`[${ts}] ✍️  Signing commitment...`)
            break
          case 'signed':
            console.log(`[${ts}] ✅ Commitment signed (cumulative: ${event.cumulativeAmount} stroops)`)
            break
        }
      },
    }),
  ],
})

// Make requests to the payment-gated channel server
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001'

console.log(`\nRequesting ${SERVER_URL}...\n`)
const response = await fetch(SERVER_URL)
const data = await response.json()

console.log(`\n--- Response (${response.status}) ---`)
console.log(JSON.stringify(data, null, 2))

// Make a second request to show cumulative commitment growth
console.log(`\n\nMaking second request to show cumulative growth...\n`)
const response2 = await fetch(SERVER_URL)
const data2 = await response2.json()

console.log(`\n--- Response 2 (${response2.status}) ---`)
console.log(JSON.stringify(data2, null, 2))
