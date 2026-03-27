/**
 * Example: Stellar MPP Server
 *
 * Charges 0.01 USDC per request via Soroban SAC transfer.
 * Uses Express with security headers (helmet, CORS, rate limiting).
 *
 * Usage:
 *   STELLAR_RECIPIENT=GYOUR_PUBLIC_KEY npx tsx examples/server.ts
 *
 * Then test with:
 *   STELLAR_SECRET=SYOUR_SECRET_KEY npx tsx examples/client.ts
 */

import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Keypair } from '@stellar/stellar-sdk'
import { Mppx } from 'mppx/server'
import { Mppx as MppxClient } from 'mppx/client'
import { stellar } from '../sdk/src/charge/server/index.js'
import { stellar as stellarClient } from '../sdk/src/charge/client/index.js'
import { USDC_SAC_TESTNET } from '../sdk/src/constants.js'
import { Env } from './config/charge-server.js'

const app = express()

// Security middleware
app.set('trust proxy', Env.trustProxy)
app.use(helmet())
app.use(
  cors({
    origin: Env.corsOrigin,
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['WWW-Authenticate'],
  }),
)
app.use(rateLimit({ windowMs: Env.rateLimitWindowMs, max: Env.rateLimitMax }))
app.use(express.json())

const mppx = Mppx.create({
  secretKey: Env.mppSecretKey,
  methods: [
    stellar.charge({
      recipient: Env.stellarRecipient,
      currency: USDC_SAC_TESTNET,
      network: 'testnet',
    }),
  ],
})

// Serve demo UI at /demo
app.get('/demo', (_req, res) => {
  try {
    const html = readFileSync(join(import.meta.dirname!, '..', 'demo', 'index.html'), 'utf-8')
    res.type('html').send(html)
  } catch {
    res.status(404).send('demo/index.html not found')
  }
})

// POST /demo/pay — full end-to-end: sign + pay using provided secret key
app.post('/demo/pay', async (req, res) => {
  try {
    const { secretKey, mode = 'pull' } = req.body as { secretKey: string; mode?: 'pull' | 'push' }

    if (!secretKey || !secretKey.startsWith('S')) {
      res.status(400).json({ error: 'Provide a valid secretKey (S...)' })
      return
    }

    const keypair = Keypair.fromSecret(secretKey)
    const events: { type: string; ts: string; [k: string]: unknown }[] = []

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

    const response = await fetch(`http://localhost:${Env.port}`)
    const data = await response.json().catch(() => null)

    res.status(response.status).json({ status: response.status, data, events })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('POST /demo/pay error:', err)
    res.status(500).json({ error: message })
  }
})

// Main MPP endpoint — catch-all so every route is payment-gated (matches original behavior)
app.use(async (req, res) => {
  const webReq = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: new Headers(req.headers as Record<string, string>),
  })

  const result = await mppx.charge({
    amount: '0.01',
    description: 'Premium API access',
  })(webReq)

  if (result.status === 402) {
    const challenge = result.challenge
    res.status(challenge.status)
    challenge.headers.forEach((v, k) => res.setHeader(k, v))
    res.send(await challenge.text())
    return
  }

  const receipt = result.withReceipt(
    Response.json({
      message: 'Payment verified — here is your premium content.',
      timestamp: new Date().toISOString(),
    }),
  )
  res.status(receipt.status)
  receipt.headers.forEach((v, k) => res.setHeader(k, v))
  res.send(await receipt.text())
})

app.listen(Env.port, () => {
  console.log(`🚀 Stellar MPP server running on http://localhost:${Env.port}`)
  console.log(`🌐 Demo UI available at http://localhost:${Env.port}/demo`)
  console.log(`   Recipient: ${Env.stellarRecipient}`)
})
