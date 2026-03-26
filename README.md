# stellar-mpp-sdk

Stellar blockchain payment method for the [Machine Payments Protocol (MPP)](https://mpp.dev). Enables machine-to-machine payments using Soroban SAC token transfers on the Stellar network, with optional support for [one-way payment channels](https://github.com/stellar-experimental/one-way-channel) for high-frequency off-chain payments.


## Payment modes

### Charge (one-time transfers)

Each payment is a Soroban SAC `transfer` settled on-chain individually.

```
Client                          Server                         Stellar
  |                               |                               |
  |  GET /resource                |                               |
  |------------------------------>|                               |
  |                               |                               |
  |  402 Payment Required         |                               |
  |  (challenge: pay 0.01 USDC)   |                               |
  |<------------------------------|                               |
  |                               |                               |
  |  prepareTransaction ----------------- (simulate) ------------>|
  |  Sign SAC transfer            |                               |
  |  Send credential (XDR)        |                               |
  |------------------------------>|                               |
  |                               |  sendTransaction ------------>|
  |                               |  getTransaction (poll) ------>|
  |  200 OK + data                |                               |
  |<------------------------------|                               |
```

Two credential modes:

- **Pull** (default) — client prepares the transaction, server submits it:
  - *Sponsored* (`feePayer` configured on server): client signs only Soroban auth entries using an all-zeros placeholder source; server rebuilds the tx with its own account as source, signs, and broadcasts
  - *Unsponsored*: client builds and signs the full transaction; server broadcasts as-is
- **Push** — client broadcasts the transaction itself, sends the tx hash for server verification (not compatible with `feePayer`)

### Channel (off-chain commitments)

Uses a [one-way payment channel](https://github.com/stellar-experimental/one-way-channel) contract. The funder deposits tokens into a channel once, then makes many off-chain payments by signing cumulative commitments — no per-payment on-chain transactions.

```
Client (Funder)                 Server (Recipient)                Stellar
  |                               |                                  |
  |  [Channel opened on-chain     |                                  |
  |   with initial deposit]       |                                  |
  |  (see "open" action below)    |                                  |
  |                               |                                  |
  |  GET /resource                |                                  |
  |------------------------------>|                                  |
  |                               |                                  |
  |  402 Payment Required         |                                  |
  |  (pay 1 XLM, cumulative: 0)   |                                  |
  |<------------------------------|                                  |
  |                               |                                  |
  |  simulate prepare_commitment------------------------------------>|
  |  Sign commitment off-chain    |                                  |
  |  (cumulative: 1 XLM + sig)    |                                  |
  |------------------------------>|                                  |
  |                               |  simulate prepare_commitment --->|
  |                               |  Verify ed25519 signature        |
  |  200 OK + data                |                                  |
  |<------------------------------|                                  |
  |                               |                                  |
  |  GET /resource (again)        |                                  |
  |------------------------------>|                                  |
  |                               |                                  |
  |  402 (pay 1 XLM,              |                                  |
  |   cumulative: 1 XLM)          |                                  |
  |<------------------------------|                                  |
  |                               |                                  |
  |  simulate prepare_commitment------------------------------------>|
  |  Sign commitment              |                                  |
  |  (cumulative: 2 XLM + sig)    |                                  |
  |------------------------------>|                                  |
  |                               |  simulate prepare_commitment --->|
  |                               |  Verify, 200 OK                  |
  |<------------------------------|                                  |
  |                               |                                  |
  |                               |  [close channel when convenient] |
  |                               |  sendTransaction (close) ------->|
```

## Install

```bash
npm install stellar-mpp-sdk mppx @stellar/stellar-sdk
```

## Quick start

### Server (charge)

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

### Client (charge)

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

### Server (channel)

```ts
import { Mppx, stellar, Store } from 'stellar-mpp-sdk/channel/server'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    stellar.channel({
      channel: 'CABC...',            // deployed one-way-channel contract address
      commitmentKey: 'GFUNDER...',   // ed25519 public key for verifying commitments
      store: Store.memory(),         // tracks cumulative amounts + replay protection
      network: 'testnet',
    }),
  ],
})

export async function handler(request: Request) {
  const result = await mppx.channel({
    amount: '1',                     // 1 XLM per request (human-readable)
    description: 'API call',
  })(request)

  if (result.status === 402) return result.challenge

  return result.withReceipt(
    Response.json({ data: 'paid content here' }),
  )
}
```

### Client (channel)

```ts
import { Keypair } from '@stellar/stellar-sdk'
import { Mppx, stellar } from 'stellar-mpp-sdk/channel/client'

Mppx.create({
  methods: [
    stellar.channel({
      commitmentKey: Keypair.fromSecret('S...'), // ed25519 key matching the channel's commitment_key
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
| `stellar-mpp-sdk` | `Methods`, `ChannelMethods`, constants (`USDC_SAC_TESTNET`, `XLM_SAC_MAINNET`, etc.), `toBaseUnits`, `fromBaseUnits` |
| `stellar-mpp-sdk/client` | `stellar`, `charge`, `Mppx` |
| `stellar-mpp-sdk/server` | `stellar`, `charge`, `Mppx`, `Store`, `Expires` |
| `stellar-mpp-sdk/channel` | `channel` (method schema) |
| `stellar-mpp-sdk/channel/client` | `stellar`, `channel`, `Mppx` |
| `stellar-mpp-sdk/channel/server` | `stellar`, `channel`, `close`, `getChannelState`, `watchChannel`, `Mppx`, `Store`, `Expires` |

### Server options (charge)

```ts
stellar.charge({
  recipient: string,              // Stellar public key (G...) or contract (C...)
  currency: string,               // SAC contract address
  network?: 'testnet' | 'public', // default: 'testnet'
  decimals?: number,              // default: 7
  rpcUrl?: string,                // custom Soroban RPC URL
  signer?: Keypair | string,      // source account for sponsored tx signing
  feeBumpSigner?: Keypair | string, // wraps all txs in FeeBumpTransaction
  store?: Store.Store,            // replay protection
})
```

### Client options (charge)

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

### Server options (channel)

```ts
stellar.channel({
  channel: string,                // on-chain channel contract address (C...)
  commitmentKey: string | Keypair,// ed25519 public key for verifying commitments
  network?: 'testnet' | 'public', // default: 'testnet'
  decimals?: number,              // default: 7
  rpcUrl?: string,                // custom Soroban RPC URL
  sourceAccount?: string,         // funded G... address for simulations
  store?: Store.Store,            // replay protection + cumulative amount tracking
})
```

### Client options (channel)

```ts
stellar.channel({
  commitmentKey?: Keypair,        // ed25519 Keypair for signing commitments
  commitmentSecret?: string,      // ed25519 secret key (S...)
  rpcUrl?: string,                // custom Soroban RPC URL
  sourceAccount?: string,         // funded G... address for simulations
  onProgress?: (event) => void,   // lifecycle callback
})
```

### Progress events

The `onProgress` callback receives events at each stage:

**Charge events:**

| Event | Fields | When |
|-------|--------|------|
| `challenge` | `recipient`, `amount`, `currency` | Challenge received |
| `signing` | — | Before signing |
| `signed` | `transaction` | After signing |
| `paying` | — | Before broadcast (push mode) |
| `confirming` | `hash` | Polling for confirmation (push mode) |
| `paid` | `hash` | Transaction confirmed (push mode) |

**Channel events:**

| Event | Fields | When |
|-------|--------|------|
| `challenge` | `channel`, `amount`, `cumulativeAmount` | Challenge received |
| `signing` | — | Before signing commitment |
| `signed` | `cumulativeAmount` | Commitment signed |

### Fee sponsorship

The server can decouple sequence-number management from fee payment:

- **`signer`** — keypair providing the source account and sequence number for sponsored transactions.
- **`feeBumpSigner`** — optional dedicated fee payer. When set, all submitted transactions are wrapped in a `FeeBumpTransaction` signed by this key.

```ts
stellar.charge({
  recipient: 'G...',
  currency: USDC_SAC_TESTNET,
  signer: Keypair.fromSecret('S...'),         // source account
  feeBumpSigner: Keypair.fromSecret('S...'),  // pays all fees
})
```

The client is automatically informed of fee sponsorship via `methodDetails.feePayer` in the challenge.

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

### One-way payment channels

Payment channels allow many off-chain micro-payments with minimal on-chain transactions. The [one-way-channel](https://github.com/stellar-experimental/one-way-channel) contract is deployed on Soroban — no additional npm dependency is needed.

**Prerequisites:**
1. Deploy the channel contract on Stellar (see [one-way-channel repo](https://github.com/stellar-experimental/one-way-channel))
2. The funder opens the channel with an initial token deposit, a `commitment_key` (ed25519 public key), the recipient address, and a refund waiting period
3. Both client (funder) and server (recipient) use the channel contract address

**How it works:**
- The client signs cumulative commitment amounts off-chain using the ed25519 commitment key
- The server verifies signatures by simulating `prepare_commitment` on the channel contract and checking the ed25519 signature
- A `Store` is required on the server to track cumulative amounts across requests
- The server can call `close()` on-chain at any time to settle accumulated payments

**Opening a channel via the SDK:**

The SDK also supports opening a channel through the MPP 402 flow using the `open` action. The client builds the deploy transaction externally (e.g., `stellar contract deploy --send=no`), then passes it as `openTransaction` context alongside an initial commitment. The server verifies the commitment signature and broadcasts the deploy transaction on-chain. See [`examples/channel-open.ts`](examples/channel-open.ts) for a complete example.

**On-chain close (server-side):**

```ts
import { close } from 'stellar-mpp-sdk/channel/server'

await close({
  channel: 'CABC...',           // channel contract address
  amount: 8000000n,             // commitment amount to close with
  signature: commitmentSigBytes,// ed25519 signature from the latest commitment
  closeKey: recipientKeypair,   // keypair to sign the close transaction
  network: 'testnet',
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

### Channel end-to-end (with on-chain settlement)

Run the full channel lifecycle — deploy, off-chain payments, and on-chain close — in a single command:

```bash
# Build the one-way-channel WASM first (see https://github.com/stellar-experimental/one-way-channel)
WASM_PATH=path/to/channel.wasm ./demo/run-channel-e2e.sh
```

See [demo/channel-e2e-output.txt](demo/channel-e2e-output.txt) for example output with Stellar Expert links.

## Project structure

```
stellar-mpp-sdk/
├── sdk/src/
│   ├── Methods.ts          # Method schema (name: 'stellar', intent: 'charge')
│   ├── constants.ts        # SAC addresses, RPC URLs, network passphrases
│   ├── scval.ts            # Soroban ScVal ↔ BigInt conversion
│   ├── index.ts            # Root exports
│   ├── client/
│   │   ├── Charge.ts       # Client-side credential creation (SAC transfer)
│   │   ├── Methods.ts      # stellar.charge() convenience wrapper
│   │   └── index.ts
│   ├── server/
│   │   ├── Charge.ts       # Server-side verification + broadcast
│   │   ├── Methods.ts      # stellar.charge() convenience wrapper
│   │   └── index.ts
│   └── channel/
│       ├── Methods.ts      # Method schema (name: 'stellar', intent: 'channel')
│       ├── index.ts        # Channel root exports
│       ├── client/
│       │   ├── Channel.ts  # Client-side commitment signing
│       │   ├── Methods.ts  # stellar.channel() convenience wrapper
│       │   └── index.ts
│       └── server/
│           ├── Channel.ts  # Server-side commitment verification + close
│           ├── State.ts    # On-chain channel state queries
│           ├── Watcher.ts  # Contract event polling (close, refund, top_up)
│           ├── Methods.ts  # stellar.channel() convenience wrapper
│           └── index.ts
├── examples/
│   ├── server.ts           # Example server (Node http + tsx)
│   ├── client.ts           # Example client with progress events
│   ├── channel-server.ts   # Channel server example
│   ├── channel-client.ts   # Channel client example
│   ├── channel-open.ts     # Channel deployment example
│   └── channel-close.ts    # On-chain channel close example
├── demo/
│   ├── index.html          # Interactive browser UI (served at /demo)
│   ├── run.sh              # All-in-one charge demo script
│   ├── run-channel.sh      # Off-chain channel demo script
│   ├── run-channel-e2e.sh  # Full lifecycle e2e demo (deploy → pay → close)
│   ├── channel-e2e-output.txt # Example e2e output with Stellar Expert links
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
