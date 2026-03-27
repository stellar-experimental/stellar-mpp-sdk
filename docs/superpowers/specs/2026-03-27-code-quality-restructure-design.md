# Code Quality & Restructure — stellar-mpp-sdk

**Date:** 2026-03-27
**Status:** Approved
**Branch:** chore/productionalize
**Version:** 0.1.0 → 0.2.0 (breaking changes)

## Goal

Improve project organization, eliminate code duplication, add robustness (timeouts, backoff, error classification), and make the SDK a production-quality example for the Stellar community.

## Implementation Steps

Steps are ordered by dependency.

---

### Step 1: Directory Restructure

Move charge code into its own `charge/` folder, symmetric with `channel/`. Breaking change — no backward-compatible re-exports.

**New structure:**

```
sdk/src/
├── index.ts                    ← public root exports
├── constants.ts                ← public constants (SAC addresses, RPC URLs, networks)
├── env.ts                      ← public env parsing primitives
├── shared/                     ← internal utilities (NOT exported from package)
│   ├── poll.ts                 ← pollTransaction()
│   ├── fee-bump.ts             ← wrapFeeBump()
│   ├── validation.ts           ← validateHexSignature(), validateAmount()
│   ├── keypairs.ts             ← resolveKeypair() (expanded)
│   ├── scval.ts                ← moved from root
│   ├── simulate.ts             ← simulateCall() with error classification
│   ├── constants.ts            ← internal defaults
│   ├── logger.ts               ← Logger interface + noopLogger
│   └── units.ts                ← toBaseUnits(), fromBaseUnits() moved from Methods.ts
├── charge/
│   ├── Methods.ts              ← charge Zod schema (moved from root Methods.ts)
│   ├── index.ts                ← charge root exports
│   ├── client/
│   │   ├── Charge.ts
│   │   ├── Methods.ts          ← stellar.charge() wrapper
│   │   └── index.ts
│   └── server/
│       ├── Charge.ts
│       ├── Methods.ts          ← stellar.charge() wrapper
│       └── index.ts
├── channel/
│   ├── Methods.ts              ← stays
│   ├── index.ts
│   ├── client/
│   │   ├── Channel.ts
│   │   ├── Methods.ts
│   │   └── index.ts
│   └── server/
│       ├── Channel.ts          ← slimmed (shared utils extracted)
│       ├── State.ts
│       ├── Watcher.ts
│       ├── Methods.ts
│       └── index.ts
```

**Files removed (old paths):**
- `sdk/src/Methods.ts` → moved to `sdk/src/charge/Methods.ts`
- `sdk/src/client/` → moved to `sdk/src/charge/client/`
- `sdk/src/server/` → moved to `sdk/src/charge/server/`
- `sdk/src/scval.ts` → moved to `sdk/src/shared/scval.ts`
- `sdk/src/signers.ts` → replaced by `sdk/src/shared/keypairs.ts`

**Package.json exports (breaking):**

```json
{
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./charge": { "types": "./dist/charge/index.d.ts", "default": "./dist/charge/index.js" },
  "./charge/client": { "types": "./dist/charge/client/index.d.ts", "default": "./dist/charge/client/index.js" },
  "./charge/server": { "types": "./dist/charge/server/index.d.ts", "default": "./dist/charge/server/index.js" },
  "./channel": { "types": "./dist/channel/index.d.ts", "default": "./dist/channel/index.js" },
  "./channel/client": { "types": "./dist/channel/client/index.d.ts", "default": "./dist/channel/client/index.js" },
  "./channel/server": { "types": "./dist/channel/server/index.d.ts", "default": "./dist/channel/server/index.js" },
  "./env": { "types": "./dist/env.d.ts", "default": "./dist/env.js" }
}
```

Remove old paths: `./client`, `./server`.

---

### Step 2: Shared Utilities

Create `sdk/src/shared/` with extracted and new utilities. These are internal — not exported from the package.

**`shared/poll.ts` — Transaction polling:**
- `pollTransaction(rpcServer, hash, opts?)` — replaces 4+ inline polling loops
- Handles all RPC response statuses: `SUCCESS` (return), `FAILED` (throw with details), `NOT_FOUND` (retry), RPC errors (throw immediately)
- Options: `maxAttempts` (default 30), `delayMs` (default 1000), `backoffMultiplier` (default 1.2), `jitterMs` (default 200), `timeoutMs` (default 30_000)
- Exponential backoff with random jitter
- AbortSignal support

**`shared/fee-bump.ts` — Fee bump wrapping:**
- `wrapFeeBump(tx, signer, opts?)` — replaces 4 inline blocks
- Options: `maxFeeStroops` (default 10_000_000)
- Handles both Transaction and FeeBumpTransaction inputs

**`shared/validation.ts` — Input validation:**
- `validateHexSignature(hex, expectedLength?)` — replaces duplicated regex checks
- `validateAmount(amount)` — validates BigInt string before conversion

**`shared/keypairs.ts` — Expanded keypair resolution:**
- `resolveKeypair(input)` — handles: Keypair instance, S... secret string, raw hex ed25519 seed
- Replaces `signers.ts` and all inline keypair conversions

**`shared/scval.ts`** — Moved from root `sdk/src/scval.ts`. Same code, new location.

**`shared/simulate.ts` — Simulation wrapper:**
- `simulateCall(rpcServer, tx, opts?)` — wraps `simulateTransaction()` with timeout
- Error classification: `SimulationContractError` (revert), `SimulationNetworkError` (transient), `SimulationTimeoutError`
- Options: `timeoutMs` (default 10_000)

**`shared/logger.ts` — Logger interface:**

```ts
interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}
```

- Export `noopLogger` (all methods are no-ops)
- Pino-compatible — consumers pass their own instance
- Not a dependency of the SDK

**`shared/constants.ts` — Internal defaults:**

```ts
export const DEFAULT_MAX_FEE_BUMP_STROOPS = 10_000_000
export const DEFAULT_POLL_MAX_ATTEMPTS = 30
export const DEFAULT_POLL_DELAY_MS = 1_000
export const DEFAULT_POLL_BACKOFF_MULTIPLIER = 1.2
export const DEFAULT_POLL_JITTER_MS = 200
export const DEFAULT_POLL_TIMEOUT_MS = 30_000
export const DEFAULT_SIMULATION_TIMEOUT_MS = 10_000
```

**`shared/units.ts`** — `toBaseUnits()` and `fromBaseUnits()` moved from `Methods.ts`. Re-exported from root `index.ts` to preserve public API.

---

### Step 3: Store Key Standardization

Pattern: `stellar:{intent}:{type}:{id}`

| Old Key | New Key | Purpose |
|---------|---------|---------|
| `stellar:tx:${hash}` | `stellar:charge:hash:${hash}` | Charge tx dedup |
| `stellar:challenge:${id}` (charge) | `stellar:charge:challenge:${id}` | Charge replay protection |
| `stellar:challenge:${id}` (channel) | `stellar:channel:challenge:${id}` | Channel replay protection |
| `stellar:channel:cumulative:${addr}` | `stellar:channel:cumulative:${addr}` | Unchanged |
| `stellar:channel:finalized:${addr}` | `stellar:channel:closed:${addr}` | Renamed: finalized → closed |
| `stellar:channel:state:${addr}` | `stellar:channel:state:${addr}` | Unchanged |

Also rename all internal variable names and error messages from `finalized` to `closed`.

Breaking change — acceptable at 0.2.0.

---

### Step 4: Configurable Parameters

All defaults set explicitly at parameter destructuring for visibility.

**Charge server `charge(parameters)` — new optional fields:**

```ts
export function charge({
  currency,
  recipient,
  signer: signerParam,
  feeBumpSigner: feeBumpSignerParam,
  decimals = DEFAULT_DECIMALS,
  network = 'testnet',
  rpcUrl,
  store,
  maxFeeBumpStroops = DEFAULT_MAX_FEE_BUMP_STROOPS,
  pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
  pollDelayMs = DEFAULT_POLL_DELAY_MS,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  simulationTimeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS,
  logger = noopLogger,
}: charge.Parameters) {
```

**Channel server `channel(parameters)` — same new fields.**

**Charge client `charge(parameters)` — lighter set (polls in push mode only):**
- `pollMaxAttempts`, `pollDelayMs`, `pollTimeoutMs`, `simulationTimeoutMs`

**Channel client `channel(parameters)` — simulation timeout only:**
- `simulationTimeoutMs`

---

### Step 5: Cleanups

**Dynamic import fix:**
- `channel/client/Channel.ts` line 96: replace `await import('@stellar/stellar-sdk')` with static import at top of file

**Keypair standardization:**
- All charge/channel client and server implementations use `resolveKeypair()` from `shared/keypairs.ts`
- Remove inline `Keypair.fromSecret()` and `Keypair.fromRawEd25519Seed()` calls

**Error message prefixes:**
- Charge errors: `"[stellar:charge] ..."`
- Channel errors: `"[stellar:channel] ..."`
- Helps identify which payment mode generated the error in logs

**`toBaseUnits` / `fromBaseUnits` relocation:**
- Move to `shared/units.ts`
- Re-export from root `index.ts` and charge `Methods.ts` to preserve public API

---

### Step 6: Robustness

**Polling (via `shared/poll.ts`):**
- Exponential backoff: delay = `delayMs * backoffMultiplier^attempt`
- Random jitter: `± jitterMs` added to each delay
- Wall-clock timeout: `timeoutMs` (default 30s) caps total polling time
- All 4+ inline polling loops replaced

**Simulation (via `shared/simulate.ts`):**
- Timeout: `simulationTimeoutMs` (default 10s) on each `simulateTransaction()` call
- Error classification:
  - `SimulationContractError` — contract reverted (user/logic error)
  - `SimulationNetworkError` — RPC unreachable or returned non-simulation error
  - `SimulationTimeoutError` — simulation did not complete in time
- Better error messages with parsed revert details when available

**Logger integration:**
- Server-side only (charge server + channel server)
- Used for: tx rebuild/broadcast events, poll progress, fee bump wrapping, signature verification, store operations, on-chain state checks
- Errors logged at `warn`/`error` before throwing
- Clients use `onProgress` callbacks instead (already exist)

---

### Step 7: Pino in Example Servers

**New devDependencies:** `pino`, `pino-http`

**Both `examples/server.ts` and `examples/channel-server.ts`:**
- Create pino instance
- Use `pino-http` middleware for request logging
- Pass pino logger to `stellar.charge()` / `stellar.channel()` as `logger` option
- Shows recommended production pattern

---

### Step 8: Docs + Version Bump

**package.json:**
- Version: `0.1.0` → `0.2.0`
- Exports: updated per Step 1

**README.md:**
- Update all import paths to new structure
- Update exports table
- Update project structure tree
- Add configurable options section (polling, fee bump, timeouts, logger)
- Update server/client options tables
- Show pino integration example

**CLAUDE.md:**
- Update module map with `shared/`, `charge/`
- Update subpath exports
- Note `shared/` convention (internal, not exported)
- Update key patterns section

---

### Step 9: Review Gates

1. `/review` — code quality, consistency, adherence to spec
2. `/security-review` — security headers, env handling, timeouts, error exposure
