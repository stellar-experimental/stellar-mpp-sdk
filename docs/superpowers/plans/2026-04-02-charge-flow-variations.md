# Charge Flow Variations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose all 6 charge payment flows as runnable example scripts driven by env vars.

**Architecture:** Extend the existing `charge-client.ts` and `charge-server.ts` with new optional env vars for mode/sponsorship; add a new `charge-client-fee-bump.ts` that manually builds fee-bumped transactions using `Method.toClient()` + `wrapFeeBump()` directly (no SDK changes). The 6 flows are: push, push+FeeBump, pull-non-sponsored, pull-non-sponsored+FeeBump, pull-sponsored, pull-sponsored+FeeBump.

**Tech Stack:** TypeScript, @stellar/stellar-sdk, mppx, tsx

---

## File Map

| Action | File                                           | Change                                                                          |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Modify | `examples/config/charge-client.ts`             | Add `CHARGE_CLIENT_MODE` (push\|pull, default pull)                             |
| Modify | `examples/config/charge-server.ts`             | Add optional `ENVELOPE_SIGNER_SECRET`, `FEE_BUMP_SIGNER_SECRET`                 |
| Modify | `examples/charge-client.ts`                    | Replace hardcoded `mode: 'pull'` with `Env.chargeClientMode`                    |
| Modify | `examples/charge-server.ts`                    | Conditionally build `feePayer` from env vars                                    |
| Modify | `examples/.env.charge-client.example`          | Document `CHARGE_CLIENT_MODE`                                                   |
| Modify | `examples/.env.charge-server.example`          | Document sponsorship env vars                                                   |
| Create | `examples/config/charge-client-fee-bump.ts`    | Config: `STELLAR_SECRET`, `FEE_BUMP_SECRET`, `SERVER_URL`, `CHARGE_CLIENT_MODE` |
| Create | `examples/charge-client-fee-bump.ts`           | Manual fee-bump implementation using `Method.toClient` + `wrapFeeBump`          |
| Create | `examples/.env.charge-client-fee-bump.example` | Env template for fee-bump client                                                |
| Modify | `CLAUDE.md`                                    | Add `charge-client-fee-bump.ts` to the example script verification list         |
| Modify | `.claude/skills/e2e-check/SKILL.md`            | Add Check 2b: 6-flow charge variations with exact commands                      |

---

## The 6 Flows

| #   | Flow                         | Client Script             | `CHARGE_CLIENT_MODE` | Server `ENVELOPE_SIGNER_SECRET` | Server `FEE_BUMP_SIGNER_SECRET` |
| --- | ---------------------------- | ------------------------- | -------------------- | ------------------------------- | ------------------------------- |
| 1   | push                         | charge-client.ts          | `push`               | —                               | —                               |
| 2   | push + FeeBump               | charge-client-fee-bump.ts | `push`               | —                               | —                               |
| 3   | pull non-sponsored           | charge-client.ts          | `pull` (default)     | —                               | —                               |
| 4   | pull non-sponsored + FeeBump | charge-client-fee-bump.ts | `pull` (default)     | —                               | —                               |
| 5   | pull sponsored               | charge-client.ts          | `pull` (default)     | set                             | —                               |
| 6   | pull sponsored + FeeBump     | charge-client.ts          | `pull` (default)     | set                             | set                             |

---

## Task 1: Extend charge-server config and script

**Files:**

- Modify: `examples/config/charge-server.ts`
- Modify: `examples/charge-server.ts`
- Modify: `examples/.env.charge-server.example`

- [ ] **Step 1: Add optional env vars to config**

Edit `examples/config/charge-server.ts`. Add two getters after the existing ones:

```ts
static get envelopeSignerSecret(): string | undefined {
  return parseOptional('ENVELOPE_SIGNER_SECRET')
}

static get feeBumpSignerSecret(): string | undefined {
  return parseOptional('FEE_BUMP_SIGNER_SECRET')
}
```

Note: `ENVELOPE_SIGNER_SECRET` and `FEE_BUMP_SIGNER_SECRET` are intentionally returned as raw strings from `parseOptional`. `Keypair.fromSecret()` is called in `charge-server.ts` (not the config), consistent with how the existing `Env.stellarRecipient` pattern works. Do NOT add `parseStellarSecretKey` to the config.

- [ ] **Step 2: Wire feePayer in charge-server.ts**

In `examples/charge-server.ts`, add a `Keypair` import is already there. Before `Mppx.create(...)`, build the optional `feePayer`:

```ts
const feePayer = Env.envelopeSignerSecret
  ? {
      envelopeSigner: Keypair.fromSecret(Env.envelopeSignerSecret),
      ...(Env.feeBumpSignerSecret
        ? { feeBumpSigner: Keypair.fromSecret(Env.feeBumpSignerSecret) }
        : {}),
    }
  : undefined
```

Then inside `stellar.charge({...})`, add after `store: Store.memory(),`:

```ts
...(feePayer ? { feePayer } : {}),
```

- [ ] **Step 3: Update .env.charge-server.example**

Append to the file:

```
# Fee sponsorship — enables pull-sponsored modes (flows 5 and 6)
# Leave unset for push/pull-unsponsored modes (flows 1-4)
# ENVELOPE_SIGNER_SECRET=S_YOUR_ENVELOPE_SIGNER_SECRET_KEY_HERE

# Fee bump signer — only used when ENVELOPE_SIGNER_SECRET is set (flow 6)
# FEE_BUMP_SIGNER_SECRET=S_YOUR_FEE_BUMP_SIGNER_SECRET_KEY_HERE
```

- [ ] **Step 4: Verify the server still loads without the new env vars**

```bash
PORT=3099 STELLAR_RECIPIENT=GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKUVJ3LKEWI4ZNVPP5EFC \
  timeout 3 npx tsx examples/charge-server.ts 2>&1 | head -5
```

Expected: pino JSON log line with `"Stellar MPP server started"`. No errors.

---

## Task 2: Extend charge-client config and script

**Files:**

- Modify: `examples/config/charge-client.ts`
- Modify: `examples/charge-client.ts`
- Modify: `examples/.env.charge-client.example`

- [ ] **Step 1: Add CHARGE_CLIENT_MODE getter to config**

Edit `examples/config/charge-client.ts`. Add a getter:

```ts
static get chargeClientMode(): 'push' | 'pull' {
  const mode = parseOptional('CHARGE_CLIENT_MODE', 'pull')!
  if (mode !== 'push' && mode !== 'pull') {
    throw new Error(`CHARGE_CLIENT_MODE must be 'push' or 'pull', got: ${mode}`)
  }
  return mode as 'push' | 'pull'
}
```

- [ ] **Step 2: Use chargeClientMode in charge-client.ts**

In `examples/charge-client.ts`, replace `mode: 'pull', // server broadcasts the signed tx` with:

```ts
mode: Env.chargeClientMode,
```

- [ ] **Step 3: Update .env.charge-client.example**

Append:

```
# Charge mode: 'pull' (server broadcasts) or 'push' (client broadcasts)
# CHARGE_CLIENT_MODE=pull
```

- [ ] **Step 4: Verify client still loads**

```bash
STELLAR_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  SERVER_URL=http://localhost:9999 \
  timeout 5 npx tsx examples/charge-client.ts 2>&1 | head -5
```

Expected: `Using Stellar account: G...` then ECONNREFUSED (expected).

---

## Task 3: Create charge-client-fee-bump config

**Files:**

- Create: `examples/config/charge-client-fee-bump.ts`
- Create: `examples/.env.charge-client-fee-bump.example`

- [ ] **Step 1: Create config file**

```ts
import { parseOptional, parseStellarSecretKey } from '../../sdk/src/env.js'

export class Env {
  static get stellarSecret(): string {
    return parseStellarSecretKey('STELLAR_SECRET')
  }

  static get feeBumpSecret(): string {
    return parseStellarSecretKey('FEE_BUMP_SECRET')
  }

  static get serverUrl(): string {
    return parseOptional('SERVER_URL', 'http://localhost:3000')!
  }

  static get chargeClientMode(): 'push' | 'pull' {
    const mode = parseOptional('CHARGE_CLIENT_MODE', 'pull')!
    if (mode !== 'push' && mode !== 'pull') {
      throw new Error(`CHARGE_CLIENT_MODE must be 'push' or 'pull', got: ${mode}`)
    }
    return mode as 'push' | 'pull'
  }
}
```

- [ ] **Step 2: Create .env.charge-client-fee-bump.example**

```
# Charge Client + FeeBump Configuration
# Used for flows 2 (push+FeeBump) and 4 (pull-non-sponsored+FeeBump)

# Client signing key (pays the SAC transfer)
STELLAR_SECRET=S_YOUR_STELLAR_SECRET_KEY_HERE

# Fee bump key (pays the network fee, wraps the inner tx)
FEE_BUMP_SECRET=S_YOUR_FEE_BUMP_SECRET_KEY_HERE

SERVER_URL=http://localhost:3000

# Charge mode: 'pull' (send fee-bumped XDR) or 'push' (broadcast fee-bumped tx)
# CHARGE_CLIENT_MODE=pull
```

---

## Task 4: Create charge-client-fee-bump.ts

**Files:**

- Create: `examples/charge-client-fee-bump.ts`

This script bypasses the `stellar.charge()` helper and uses `Method.toClient()` directly
(the same entry point used internally by the SDK) with a custom `createCredential` that
wraps the signed SAC transfer in a `FeeBumpTransaction` via `wrapFeeBump()`.

- [ ] **Step 1: Create the script**

```ts
/**
 * Example: Stellar MPP Client with FeeBump
 *
 * Demonstrates client-side FeeBumpTransaction wrapping for the unsponsored
 * charge flows:
 *   - pull + FeeBump (default): sends fee-bumped XDR for server to broadcast
 *   - push + FeeBump: client broadcasts the fee-bumped tx, sends hash
 *
 * Usage (pull + FeeBump):
 *   STELLAR_SECRET=S... FEE_BUMP_SECRET=S... \
 *     SERVER_URL=http://localhost:3000 \
 *     npx tsx examples/charge-client-fee-bump.ts
 *
 * Usage (push + FeeBump):
 *   STELLAR_SECRET=S... FEE_BUMP_SECRET=S... CHARGE_CLIENT_MODE=push \
 *     SERVER_URL=http://localhost:3000 \
 *     npx tsx examples/charge-client-fee-bump.ts
 *
 * Run against the standard charge-server.ts (no feePayer env vars needed).
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk'
import { Credential, Method } from 'mppx'
import { Mppx } from 'mppx/client'
import { charge as chargeMethod, fromBaseUnits } from '../sdk/src/charge/Methods.js'
import { SOROBAN_RPC_URLS, NETWORK_PASSPHRASE, DEFAULT_TIMEOUT } from '../sdk/src/constants.js'
import { resolveNetworkId } from '../sdk/src/shared/validation.js'
import { wrapFeeBump } from '../sdk/src/shared/fee-bump.js'
import { pollTransaction } from '../sdk/src/shared/poll.js'
import { Env } from './config/charge-client-fee-bump.js'

const keypair = Keypair.fromSecret(Env.stellarSecret)
const feeBumpKP = Keypair.fromSecret(Env.feeBumpSecret)
const mode = Env.chargeClientMode

console.log(`Using Stellar account: ${keypair.publicKey()}`)
console.log(`Using fee bump key:    ${feeBumpKP.publicKey()}`)
console.log(`Mode: ${mode}+fee-bump\n`)

Mppx.create({
  methods: [
    Method.toClient(chargeMethod, {
      async createCredential({ challenge }) {
        const { request } = challenge
        const { amount, currency, recipient } = request

        const network = resolveNetworkId(request.methodDetails?.network)
        const rpcUrl = SOROBAN_RPC_URLS[network]
        const networkPassphrase = NETWORK_PASSPHRASE[network]
        const server = new rpc.Server(rpcUrl)

        const ts = () => new Date().toISOString().slice(11, 23)
        console.log(`[${ts()}] 💳 Challenge — ${fromBaseUnits(amount, 7)} to ${recipient}`)

        // Build SAC transfer(from, to, amount) invocation
        const contract = new Contract(currency)
        const sourceAccount = await server.getAccount(keypair.publicKey())

        const tx = new TransactionBuilder(sourceAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(
            contract.call(
              'transfer',
              new Address(keypair.publicKey()).toScVal(),
              new Address(recipient).toScVal(),
              nativeToScVal(BigInt(amount), { type: 'i128' }),
            ),
          )
          .setTimeout(DEFAULT_TIMEOUT)
          .build()

        const prepared = await server.prepareTransaction(tx)

        console.log(`[${ts()}] ✍️  Signing...`)
        prepared.sign(keypair)

        // Wrap the signed tx in a FeeBumpTransaction
        const feeBumpTx = wrapFeeBump(prepared, feeBumpKP, { networkPassphrase })
        console.log(
          `[${ts()}] 📦 Wrapped in FeeBumpTransaction (fee payer: ${feeBumpKP.publicKey().slice(0, 8)}...)`,
        )

        const source = `did:pkh:${network}:${keypair.publicKey()}`

        if (mode === 'push') {
          // Client broadcasts the fee-bumped tx; server verifies the on-chain hash
          console.log(`[${ts()}] 📡 Broadcasting fee-bumped tx...`)
          const result = await server.sendTransaction(feeBumpTx)
          if (result.status === 'ERROR' || result.status === 'DUPLICATE') {
            throw new Error(`Broadcast failed: sendTransaction returned ${result.status}`)
          }
          console.log(`[${ts()}] ⏳ Confirming ${result.hash.slice(0, 12)}...`)
          await pollTransaction(server, result.hash, {})
          console.log(`[${ts()}] 🎉 Confirmed: ${result.hash}`)

          return Credential.serialize({
            challenge,
            payload: { type: 'hash' as const, hash: result.hash },
            source,
          })
        }

        // Pull mode: send fee-bumped XDR for server to broadcast as-is
        const feeBumpXdr = feeBumpTx.toXDR()
        console.log(`[${ts()}] ✅ Sending fee-bumped XDR (${feeBumpXdr.length} bytes)`)

        return Credential.serialize({
          challenge,
          payload: { type: 'transaction' as const, transaction: feeBumpXdr },
          source,
        })
      },
    }),
  ],
})

const SERVER_URL = Env.serverUrl
console.log(`\nRequesting ${SERVER_URL}...\n`)
const response = await fetch(SERVER_URL)
const data = await response.json()

console.log(`\n--- Response (${response.status}) ---`)
console.log(JSON.stringify(data, null, 2))
```

- [ ] **Step 2: Type-check the new script**

```bash
pnpm run check:types 2>&1 | tail -20
```

Expected: 0 errors.

- [ ] **Step 3: Verify the script loads (no server running → ECONNREFUSED)**

```bash
STELLAR_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  FEE_BUMP_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  SERVER_URL=http://localhost:9999 \
  timeout 5 npx tsx examples/charge-client-fee-bump.ts 2>&1 | head -6
```

Expected: prints `Using Stellar account: G...`, `Using fee bump key: G...`, `Mode: pull+fee-bump`, then connection error (ECONNREFUSED or similar).

---

## Task 5: Update CLAUDE.md verification checklist

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add charge-client-fee-bump.ts to example script validation**

In the `### 2. Example scripts (always run)` section, add after the charge-client block:

```bash
# Charge fee-bump client — should load keys, fail on network (no server running)
STELLAR_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  FEE_BUMP_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  SERVER_URL=http://localhost:9999 \
  npx tsx examples/charge-client-fee-bump.ts
# → "Using Stellar account: G..." then ECONNREFUSED (expected)
```

---

## Task 6: Update e2e-check skill

**Files:**

- Modify: `.claude/skills/e2e-check/SKILL.md`

- [ ] **Step 1: Update Check 2 to include the new fee-bump script**

In the existing Check 2 table, add a row for `examples/charge-client-fee-bump.ts`.

- [ ] **Step 2: Add Check 2b: Charge Flow Variations**

Insert a new `## Check 2b: Charge Flow Variations` section after Check 2 documenting the exact env var commands for all 6 flows.

Paste the following content directly into the skill file (no wrapper needed):

---

## Check 2b: Charge Flow Variations

Six flows are available by combining client and server env vars. Each requires a running
charge server (Terminal 1) and charge client (Terminal 2).

### Server configurations

```bash
# Unsponsored (flows 1-4): no feePayer env vars needed
PORT=3099 STELLAR_RECIPIENT=G... npx tsx examples/charge-server.ts

# Sponsored, no fee bump (flow 5): set ENVELOPE_SIGNER_SECRET
PORT=3099 STELLAR_RECIPIENT=G... ENVELOPE_SIGNER_SECRET=S... \
  npx tsx examples/charge-server.ts

# Sponsored + FeeBump (flow 6): set both signer secrets
PORT=3099 STELLAR_RECIPIENT=G... ENVELOPE_SIGNER_SECRET=S... FEE_BUMP_SIGNER_SECRET=S... \
  npx tsx examples/charge-server.ts
```

### Client invocations (Terminal 2, replace S... with real key)

```bash
# Flow 1: push (no FeeBump)
STELLAR_SECRET=S... SERVER_URL=http://localhost:3099 CHARGE_CLIENT_MODE=push \
  npx tsx examples/charge-client.ts

# Flow 2: push + FeeBump
STELLAR_SECRET=S... FEE_BUMP_SECRET=S... SERVER_URL=http://localhost:3099 CHARGE_CLIENT_MODE=push \
  npx tsx examples/charge-client-fee-bump.ts

# Flow 3: pull non-sponsored (no FeeBump)  [default CHARGE_CLIENT_MODE]
STELLAR_SECRET=S... SERVER_URL=http://localhost:3099 \
  npx tsx examples/charge-client.ts

# Flow 4: pull non-sponsored + FeeBump
STELLAR_SECRET=S... FEE_BUMP_SECRET=S... SERVER_URL=http://localhost:3099 \
  npx tsx examples/charge-client-fee-bump.ts

# Flow 5: pull sponsored (no FeeBump) — server must have ENVELOPE_SIGNER_SECRET set
STELLAR_SECRET=S... SERVER_URL=http://localhost:3099 \
  npx tsx examples/charge-client.ts

# Flow 6: pull sponsored + FeeBump
# NOTE: client invocation is identical to Flow 5 — the difference is ONLY the server config.
# The server's feeBumpSigner wraps the rebuilt tx in FeeBump; no client-side change needed.
STELLAR_SECRET=S... SERVER_URL=http://localhost:3099 \
  npx tsx examples/charge-client.ts
```

**Pass:** Each client prints `--- Response (200) ---` with paid content JSON.

---

## Task 7: Run full quality pipeline + validation

- [ ] **Step 1: Run full quality pipeline**

```bash
pnpm test -- --run && pnpm run check:types && pnpm run build
```

Expected: all tests pass, 0 type errors, build succeeds.

- [ ] **Step 2: Validate all example scripts load (including new fee-bump script)**

```bash
PORT=3099 STELLAR_RECIPIENT=GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKUVJ3LKEWI4ZNVPP5EFC \
  timeout 3 npx tsx examples/charge-server.ts 2>&1 | head -3

STELLAR_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  SERVER_URL=http://localhost:9999 \
  timeout 5 npx tsx examples/charge-client.ts 2>&1 | head -3

STELLAR_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  FEE_BUMP_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  SERVER_URL=http://localhost:9999 \
  timeout 5 npx tsx examples/charge-client-fee-bump.ts 2>&1 | head -6
```

- [ ] **Step 3: Commit**

```bash
git add examples/ CLAUDE.md .claude/skills/e2e-check/SKILL.md
git commit -m "feat(examples): add 6 charge flow variations via env vars"
```
