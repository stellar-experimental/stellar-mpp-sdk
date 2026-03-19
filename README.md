# stellar-mpp-sdk

Stellar blockchain payment method for the [Machine Payments Protocol (MPP)](https://mpp.dev). Enables machine-to-machine payments using Soroban SAC token transfers on the Stellar network.

Built on [mppx](https://github.com/nicholasgriffintn/mppx) — the TypeScript SDK for MPP.

## How it works

```
Client                          Server
  |                               |
  |  GET /resource                |
  |------------------------------>|
  |                               |
  |  402 Payment Required         |
  |  (challenge: pay 0.01 USDC)   |
  |<------------------------------|
  |                               |
  |  Sign SAC transfer on Soroban |
  |  Send credential              |
  |------------------------------>|
  |                               |
  |  Verify on-chain, return data |
  |<------------------------------|
```

Two credential modes:

- **Pull** (default) — client signs the transaction XDR, server broadcasts it
- **Push** — client broadcasts the transaction itself, sends the tx hash for server verification

## Install

```bash
npm install stellar-mpp-sdk mppx @stellar/stellar-sdk
```

## Quick start

### Server

```ts
import { Mppx, stellar } from 'stellar-mpp-sdk/server'
import { USDC_SAC_TESTNET } from 'stellar-mpp-sdk'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    stellar.charge({
      recipient: process.env.STELLAR_RECIPIENT!, // your Stellar public key (G...)
      currency: USDC_SAC_TESTNET,
      network: 'testnet',
    }),
  ],
})

// Express / Bun / any framework
export async function handler(request: Request) {
  const result = await mppx.charge({
    amount: '0.01',
    description: 'Premium API access',
  })(request)

  if (result.status === 402) return result.challenge

  return result.withReceipt(
    Response.json({ data: 'paid content here' }),
  )
}
```

### Client

```ts
import { Keypair } from '@stellar/stellar-sdk'
import { Mppx, stellar } from 'stellar-mpp-sdk/client'

// Polyfills global fetch — 402 responses are handled automatically
Mppx.create({
  methods: [
    stellar.charge({
      keypair: Keypair.fromSecret('S...'),
    }),
  ],
})

const response = await fetch('https://api.example.com/paid-resource')
const data = await response.json()
```

## API

### Exports

| Path | Exports |
|------|---------|
| `stellar-mpp-sdk` | `Methods`, constants (`USDC_SAC_TESTNET`, `XLM_SAC_MAINNET`, etc.), `toBaseUnits`, `fromBaseUnits` |
| `stellar-mpp-sdk/client` | `stellar`, `charge`, `Mppx` |
| `stellar-mpp-sdk/server` | `stellar`, `charge`, `Mppx`, `Store`, `Expires` |

### Server options

```ts
stellar.charge({
  recipient: string,              // Stellar public key (G...) or contract (C...)
  currency: string,               // SAC contract address
  network?: 'testnet' | 'public', // default: 'testnet'
  decimals?: number,              // default: 7
  rpcUrl?: string,                // custom Soroban RPC URL
  feePayer?: Keypair | string,    // sponsor tx fees via FeeBumpTransaction
  store?: Store.Store,            // replay protection
})
```

### Client options

```ts
stellar.charge({
  keypair?: Keypair,              // Stellar Keypair (or use secretKey)
  secretKey?: string,             // Stellar secret key (S...)
  mode?: 'push' | 'pull',        // default: 'pull'
  timeout?: number,               // tx timeout in seconds (default: 180)
  rpcUrl?: string,                // custom Soroban RPC URL
  onProgress?: (event) => void,   // lifecycle callback
})
```

### Progress events

The `onProgress` callback receives events at each stage:

| Event | Fields | When |
|-------|--------|------|
| `challenge` | `recipient`, `amount`, `currency`, `feePayerKey?` | Challenge received |
| `signing` | — | Before signing |
| `signed` | `xdr` | After signing |
| `paying` | — | Before broadcast (push mode) |
| `confirming` | `hash` | Polling for confirmation (push mode) |
| `paid` | `hash` | Transaction confirmed (push mode) |

### Fee sponsorship

The server can sponsor transaction fees using Stellar's `FeeBumpTransaction`:

```ts
stellar.charge({
  recipient: 'G...',
  currency: USDC_SAC_TESTNET,
  feePayer: Keypair.fromSecret('S...'),
})
```

The client is automatically informed via `methodDetails.feePayer` in the challenge.

### Replay protection

Provide an mppx `Store` to prevent challenge reuse:

```ts
import { Store } from 'stellar-mpp-sdk/server'

stellar.charge({
  recipient: 'G...',
  currency: USDC_SAC_TESTNET,
  store: Store.memory(), // or Store.upstash(), Store.cloudflare()
})
```

## Constants

| Constant | Value |
|----------|-------|
| `USDC_SAC_MAINNET` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI` |
| `USDC_SAC_TESTNET` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| `XLM_SAC_MAINNET`  | `CAS3J7GYLGVE45MR3HPSFG352DAANEV5GGMFTO3IZIE4JMCDALQO57Y` |
| `XLM_SAC_TESTNET`  | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

## Demo

See [demo/README.md](demo/README.md) for full instructions. Quick start:

```bash
# All-in-one (prompts for keys)
./demo/run.sh

# Or two terminals:
STELLAR_RECIPIENT=G... npx tsx examples/server.ts  # Terminal 1
STELLAR_SECRET=S... npx tsx examples/client.ts      # Terminal 2

# Or npm scripts:
STELLAR_RECIPIENT=G... pnpm demo:server  # Terminal 1
STELLAR_SECRET=S... pnpm demo:client      # Terminal 2
```

Browser UI available at `http://localhost:3000/demo` once the server is running.

## Project structure

```
stellar-mpp-sdk/
├── sdk/src/
│   ├── Methods.ts          # Method schema (name: 'stellar', intent: 'charge')
│   ├── constants.ts        # SAC addresses, RPC URLs, network passphrases
│   ├── index.ts            # Root exports
│   ├── client/
│   │   ├── Charge.ts       # Client-side credential creation
│   │   ├── Methods.ts      # stellar() convenience wrapper
│   │   └── index.ts
│   └── server/
│       ├── Charge.ts       # Server-side verification + broadcast
│       ├── Methods.ts      # stellar() convenience wrapper
│       └── index.ts
├── examples/
│   ├── server.ts           # Example server (Node http + tsx)
│   └── client.ts           # Example client with progress events
├── demo/
│   ├── index.html          # Interactive browser UI (served at /demo)
│   ├── run.sh              # All-in-one demo script
│   └── README.md           # Demo setup instructions
└── dist/                   # Compiled output
```

## Development

```bash
pnpm install
pnpm run build        # compile TypeScript
pnpm run check:types  # type-check without emitting
pnpm test             # run tests (vitest)
```

## License

MIT
