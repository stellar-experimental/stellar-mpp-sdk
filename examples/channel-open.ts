/**
 * Example: Open a one-way payment channel via MPP
 *
 * Sends a pre-built, signed channel-deploy transaction through the MPP
 * 402 flow as an "open" action. The server verifies the initial
 * commitment signature and broadcasts the transaction on-chain.
 *
 * The deploy transaction can be built with the stellar CLI:
 *   stellar contract deploy \
 *     --wasm-hash $WASM_HASH --source FUNDER --network testnet --send=no \
 *     -- --token native --from FUNDER --commitment_key $COMMITMENT_PKEY \
 *        --to RECIPIENT --amount 10000000 --refund_waiting_period 100
 *
 * Usage:
 *   OPEN_TX_XDR=AAAA... \
 *   COMMITMENT_SECRET=<64-hex> \
 *   npx tsx examples/channel-open.ts
 */

import { Keypair } from '@stellar/stellar-sdk'
import { Mppx } from 'mppx/client'
import { stellar } from '../sdk/src/channel/client/index.js'
import { parseHexKey, parseOptional, parseRequired } from '../sdk/src/env.js'

const OPEN_TX_XDR = parseRequired('OPEN_TX_XDR')
const COMMITMENT_SECRET = parseHexKey('COMMITMENT_SECRET')
const INITIAL_AMOUNT = parseOptional('INITIAL_AMOUNT', '10000000')! // 1 XLM default
const SERVER_URL = parseOptional('SERVER_URL', 'http://localhost:3001')!

const commitmentKey = Keypair.fromRawEd25519Seed(Buffer.from(COMMITMENT_SECRET, 'hex'))
const commitmentPubHex = Buffer.from(commitmentKey.rawPublicKey()).toString('hex')

console.log('═══════════════════════════════════════════════════════')
console.log('  Stellar MPP Channel — Open via MPP 402 Flow')
console.log('═══════════════════════════════════════════════════════')
console.log(`  Commitment key: ${commitmentPubHex.slice(0, 16)}...`)
console.log(`  Initial amount: ${INITIAL_AMOUNT} stroops (${Number(INITIAL_AMOUNT) / 1e7} XLM)`)
console.log(`  Transaction:    ${OPEN_TX_XDR.slice(0, 40)}...`)
console.log('')

// Set up the MPP client with automatic 402 handling
Mppx.create({
  methods: [
    stellar.channel({
      commitmentKey,
      sourceAccount: parseOptional('SOURCE_ACCOUNT'),
      onProgress(event) {
        const ts = new Date().toISOString().slice(11, 23)
        switch (event.type) {
          case 'challenge':
            console.log(
              `  [${ts}] 💳 Challenge received — channel ${event.channel.slice(0, 12)}...`,
            )
            break
          case 'signing':
            console.log(`  [${ts}] ✍️  Signing initial commitment...`)
            break
          case 'signed':
            console.log(
              `  [${ts}] ✅ Commitment signed (initial: ${event.cumulativeAmount} stroops)`,
            )
            break
        }
      },
    }),
  ],
})

console.log(`Requesting ${SERVER_URL}...\n`)

// Context is passed per-request via fetch's init parameter.
// The mppx client forwards it to createCredential when handling the 402.
const response = await fetch(SERVER_URL, {
  context: {
    action: 'open',
    openTransaction: OPEN_TX_XDR,
    cumulativeAmount: INITIAL_AMOUNT,
  },
} as RequestInit)
const data = await response.json()

console.log(`\n--- Response (${response.status}) ---`)
console.log(JSON.stringify(data, null, 2))

if (response.ok) {
  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log('  ✅ Channel opened on-chain via MPP!')
  console.log('  You can now send voucher payments through the channel.')
  console.log('═══════════════════════════════════════════════════════')
}
