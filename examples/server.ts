/**
 * Example: Stellar MPP Server
 *
 * Charges 0.01 USDC per request via Soroban SAC transfer.
 *
 * Usage:
 *   STELLAR_RECIPIENT=GYOUR_PUBLIC_KEY npx tsx examples/server.ts
 *
 * Then test with:
 *   STELLAR_SECRET=SYOUR_SECRET_KEY npx tsx examples/client.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Keypair } from '@stellar/stellar-sdk'
import { Mppx } from 'mppx/server'
import { Mppx as MppxClient } from 'mppx/client'
import { stellar } from '../sdk/src/server/index.js'
import { stellar as stellarClient } from '../sdk/src/client/index.js'
import { USDC_SAC_TESTNET } from '../sdk/src/constants.js'

const PORT = Number(process.env.PORT ?? 3000)
const RECIPIENT = process.env.STELLAR_RECIPIENT

if (!RECIPIENT || !RECIPIENT.startsWith('G') || RECIPIENT.length !== 56) {
  console.error('❌ Set STELLAR_RECIPIENT to a valid Stellar public key (G..., 56 chars)')
  console.error(
    '   Example: STELLAR_RECIPIENT=GC6ZBCI6M6PMBMRCZQMOGCUOZKFREM7P6G2NC3TD5FMYX3YLPAACQMJY npx tsx examples/server.ts',
  )
  process.exit(1)
}

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY ?? 'stellar-mpp-demo-secret',
  methods: [
    stellar.charge({
      recipient: RECIPIENT,
      currency: USDC_SAC_TESTNET,
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate')
  res.end(await webRes.text())
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString()
    })
    req.on('end', () => resolve(body))
  })
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    return res.end()
  }

  // Serve demo UI at /demo
  if (url.pathname === '/demo') {
    try {
      const html = readFileSync(join(import.meta.dirname!, '..', 'demo', 'index.html'), 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(html)
    } catch {
      res.writeHead(404)
      return res.end('demo/index.html not found')
    }
  }

  // POST /demo/pay — full end-to-end: sign + pay using provided secret key
  if (url.pathname === '/demo/pay' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    try {
      const body = JSON.parse(await readBody(req))
      const { secretKey, mode = 'pull' } = body as { secretKey: string; mode?: 'pull' | 'push' }

      if (!secretKey || !secretKey.startsWith('S')) {
        res.writeHead(400)
        return res.end(JSON.stringify({ error: 'Provide a valid secretKey (S...)' }))
      }

      const keypair = Keypair.fromSecret(secretKey)
      const events: { type: string; ts: string; [k: string]: unknown }[] = []

      // Wire up a temporary mppx client with the stellar charge method
      MppxClient.create({
        methods: [
          stellarClient.charge({
            keypair,
            mode,
            onProgress(event) {
              events.push({ ...event, ts: new Date().toISOString() })
            },
          }),
        ],
      })

      // Make the paid request through the patched global fetch
      const response = await fetch(`http://localhost:${PORT}`)
      const data = await response.json().catch(() => null)

      res.writeHead(response.status)
      return res.end(JSON.stringify({ status: response.status, data, events }, null, 2))
    } catch (err: any) {
      res.writeHead(500)
      return res.end(JSON.stringify({ error: err.message, stack: err.stack }))
    }
  }

  // Main MPP endpoint
  const webReq = toWebRequest(req)
  const result = await mppx.charge({
    amount: '0.01',
    description: 'Premium API access',
  })(webReq)

  if (result.status === 402) {
    return sendWebResponse(result.challenge, res)
  }

  return sendWebResponse(
    result.withReceipt(
      Response.json({
        message: 'Payment verified — here is your premium content.',
        timestamp: new Date().toISOString(),
      }),
    ),
    res,
  )
})

server.listen(PORT, () => {
  console.log(`🚀 Stellar MPP server running on http://localhost:${PORT}`)
  console.log(`🌐 Demo UI available at http://localhost:${PORT}/demo`)
  console.log(`   Recipient: ${RECIPIENT}`)
})
