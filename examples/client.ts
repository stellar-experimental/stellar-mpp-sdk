/**
 * Example: Stellar MPP Client
 *
 * Automatically handles 402 Payment Required responses by paying
 * via Soroban SAC transfer on Stellar testnet.
 *
 * Usage:
 *   STELLAR_SECRET=SYOUR_SECRET_KEY npx tsx examples/client.ts
 */

import { Keypair } from '@stellar/stellar-sdk'
import { Mppx } from 'mppx/client'
import { stellar } from '../sdk/src/client/index.js'
import { Env } from './config/charge-client.js'

const keypair = Keypair.fromSecret(Env.stellarSecret)
console.log(`Using Stellar account: ${keypair.publicKey()}`)

// Polyfill global fetch with automatic 402 handling
Mppx.create({
  methods: [
    stellar.charge({
      keypair,
      mode: 'pull', // server broadcasts the signed tx
      onProgress(event) {
        const ts = new Date().toISOString().slice(11, 23)
        switch (event.type) {
          case 'challenge':
            console.log(`[${ts}] 💳 Challenge received — ${event.amount} to ${event.recipient}`)
            break
          case 'signing':
            console.log(`[${ts}] ✍️  Signing transaction...`)
            break
          case 'signed':
            console.log(`[${ts}] ✅ Transaction signed (${event.transaction.length} bytes XDR)`)
            break
          case 'paying':
            console.log(`[${ts}] 📡 Broadcasting transaction...`)
            break
          case 'confirming':
            console.log(`[${ts}] ⏳ Confirming tx ${event.hash.slice(0, 12)}...`)
            break
          case 'paid':
            console.log(`[${ts}] 🎉 Payment confirmed: ${event.hash}`)
            break
        }
      },
    }),
  ],
})

// Make a request to the payment-gated server
const SERVER_URL = Env.serverUrl

console.log(`\nRequesting ${SERVER_URL}...\n`)
const response = await fetch(SERVER_URL)
const data = await response.json()

console.log(`\n--- Response (${response.status}) ---`)
console.log(JSON.stringify(data, null, 2))
