/**
 * Example: Stellar MPP Channel Server
 *
 * Charges per request via off-chain one-way payment channel commitments.
 * No on-chain transaction per payment — the recipient closes the channel to settle later.
 *
 * Prerequisites:
 *   - A deployed one-way-channel contract on testnet
 *   - The commitment public key used when deploying the channel
 *
 * Usage:
 *   CHANNEL_CONTRACT=CABC... COMMITMENT_PUBKEY=b83e... npx tsx examples/channel-server.ts
 *
 * Then test with:
 *   COMMITMENT_SECRET=73b5... npx tsx examples/channel-client.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StrKey } from '@stellar/stellar-sdk'
import { Mppx, Store } from 'mppx/server'
import { stellar } from '../sdk/src/channel/server/index.js'

const PORT = Number(process.env.PORT ?? 3001)
const CHANNEL_CONTRACT = process.env.CHANNEL_CONTRACT
const COMMITMENT_PUBKEY = process.env.COMMITMENT_PUBKEY

if (!CHANNEL_CONTRACT || !CHANNEL_CONTRACT.startsWith('C') || CHANNEL_CONTRACT.length !== 56) {
  console.error('❌ Set CHANNEL_CONTRACT to the deployed channel contract address (C..., 56 chars)')
  console.error(
    '   Example: CHANNEL_CONTRACT=CBU3P5BAU6CYGPAVY7TGGGNEPCS7H73IA3L677Z3CFZSGFYB7UFK4IMS',
  )
  process.exit(1)
}

if (!COMMITMENT_PUBKEY || COMMITMENT_PUBKEY.length !== 64) {
  console.error(
    '❌ Set COMMITMENT_PUBKEY to the ed25519 public key used when deploying the channel (64 hex chars)',
  )
  console.error(
    '   Example: COMMITMENT_PUBKEY=b83ee77019d9ca0aac432139fe0159ec01b5d31f58905fdc089980be05b7c5fd',
  )
  process.exit(1)
}

// Convert the raw ed25519 public key (hex) to a Stellar G... address for verification
const commitmentPublicKeyG = StrKey.encodeEd25519PublicKey(Buffer.from(COMMITMENT_PUBKEY, 'hex'))

const store = Store.memory()

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY ?? 'stellar-mpp-channel-demo-secret',
  methods: [
    stellar.channel({
      channel: CHANNEL_CONTRACT,
      commitmentKey: commitmentPublicKeyG,
      sourceAccount: process.env.SOURCE_ACCOUNT,
      store,
      network: 'testnet',
    }),
  ],
})

// ---------------------------------------------------------------------------
// Node http ↔ Web Request/Response helpers
// ---------------------------------------------------------------------------

function toWebRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? `localhost:${PORT}`}${req.url}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }
  return new Request(url, { method: req.method, headers })
}

async function sendWebResponse(webRes: Response, res: ServerResponse) {
  res.statusCode = webRes.status
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate')
  res.end(await webRes.text())
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const _url = new URL(req.url!, `http://localhost:${PORT}`)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    return res.end()
  }

  // Main MPP channel endpoint
  const webReq = toWebRequest(req)
  const result = await mppx.channel({
    amount: '0.1', // 0.1 XLM per request
    description: 'Channel-gated API access',
  })(webReq)

  if (result.status === 402) {
    return sendWebResponse(result.challenge, res)
  }

  return sendWebResponse(
    result.withReceipt(
      Response.json({
        message: 'Payment verified via channel commitment — here is your content.',
        timestamp: new Date().toISOString(),
        note: 'No on-chain transaction was needed for this payment!',
      }),
    ),
    res,
  )
})

server.listen(PORT, () => {
  console.log(`🚀 Stellar MPP Channel server running on http://localhost:${PORT}`)
  console.log(`   Channel contract: ${CHANNEL_CONTRACT}`)
  console.log(`   Commitment key:   ${COMMITMENT_PUBKEY.slice(0, 16)}...`)
  console.log(`   Charging 0.1 XLM per request (off-chain commitments)`)
})
