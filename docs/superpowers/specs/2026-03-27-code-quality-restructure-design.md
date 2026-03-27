# Code Quality & Restructure — stellar-mpp-sdk

**Date:** 2026-03-27
**Status:** Approved
**Branch:** chore/productionalize
**Version:** 0.1.0 → 0.2.0 (breaking changes)

## Goal

Improve project organization, eliminate code duplication, add robustness (timeouts, backoff, error classification), and make the SDK a production-quality example for the Stellar community.

## Implementation Steps

Steps are ordered by dependency. Steps 3, 4, and 5 all touch charge/channel server files — do them sequentially to avoid conflicts.

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
│   ├── errors.ts               ← shared error base class
│   ├── defaults.ts             ← internal defaults (renamed from constants.ts to avoid collision)
│   ├── logger.ts               ← Logger interface + noopLogger
│   └── units.ts                ← toBaseUnits(), fromBaseUnits() moved from Methods.ts
├── charge/
│   ├── Methods.ts              ← charge Zod schema (moved from root Methods.ts)
│   ├── Methods.test.ts         ← moved from root
│   ├── index.ts                ← charge root exports
│   ├── client/
│   │   ├── Charge.ts
│   │   ├── Charge.test.ts      ← moved from root client/
│   │   ├── Methods.ts          ← stellar.charge() wrapper
│   │   └── index.ts
│   └── server/
│       ├── Charge.ts
│       ├── Charge.test.ts      ← moved from root server/
│       ├── Methods.ts          ← stellar.charge() wrapper
│       └── index.ts
├── channel/
│   ├── Methods.ts              ← stays
│   ├── Methods.test.ts         ← stays
│   ├── index.ts
│   ├── client/
│   │   ├── Channel.ts
│   │   ├── Channel.test.ts     ← stays
│   │   ├── Methods.ts
│   │   └── index.ts
│   └── server/
│       ├── Channel.ts          ← slimmed (shared utils extracted)
│       ├── Channel.test.ts     ← stays
│       ├── State.ts
│       ├── State.test.ts       ← stays
│       ├── Watcher.ts
│       ├── Watcher.test.ts     ← stays
│       ├── Methods.ts
│       └── index.ts
```

**Test file migration:**
- `sdk/src/Methods.test.ts` → `sdk/src/charge/Methods.test.ts`
- `sdk/src/client/Charge.test.ts` → `sdk/src/charge/client/Charge.test.ts`
- `sdk/src/server/Charge.test.ts` → `sdk/src/charge/server/Charge.test.ts`
- `sdk/src/integration.test.ts` → `sdk/src/charge/integration.test.ts` (charge integration test)
- `sdk/src/signers.test.ts` → `sdk/src/shared/keypairs.test.ts` (updated to test new resolveKeypair)
- `sdk/src/constants.test.ts` → stays (public constants, no move needed)
- `sdk/src/env.test.ts` → stays
- `sdk/src/channel/integration.test.ts` → stays

All test import paths updated to match new source locations. All channel test files (`channel/Methods.test.ts`, `channel/client/Channel.test.ts`, `channel/server/Channel.test.ts`, `channel/server/State.test.ts`, `channel/server/Watcher.test.ts`, `channel/integration.test.ts`) stay in place — no move needed.

> Note: `pnpm lint` and `pnpm format:check` scripts already exist in `package.json` from the prior productionalization work (Step 1 of the previous spec).

**Files removed (old paths):**
- `sdk/src/Methods.ts` → moved to `sdk/src/charge/Methods.ts`
- `sdk/src/client/` → moved to `sdk/src/charge/client/`
- `sdk/src/server/` → moved to `sdk/src/charge/server/`
- `sdk/src/scval.ts` → moved to `sdk/src/shared/scval.ts`
- `sdk/src/signers.ts` → replaced by `sdk/src/shared/keypairs.ts`
- `sdk/src/integration.test.ts` → moved to `sdk/src/charge/integration.test.ts`
- `sdk/src/signers.test.ts` → replaced by `sdk/src/shared/keypairs.test.ts`

**New root `sdk/src/index.ts` exports:**

```ts
// Schemas
export * as ChargeMethods from './charge/Methods.js'
export * as ChannelMethods from './channel/Methods.js'

// Constants (public)
export {
  DEFAULT_DECIMALS, DEFAULT_FEE, DEFAULT_TIMEOUT,
  HORIZON_URLS, NETWORK_PASSPHRASE, SAC_ADDRESSES,
  SOROBAN_RPC_URLS, USDC_SAC_MAINNET, USDC_SAC_TESTNET,
  XLM_SAC_MAINNET, XLM_SAC_TESTNET, ALL_ZEROS,
  type NetworkId,
} from './constants.js'

// Unit conversion (public, moved from Methods.ts)
export { fromBaseUnits, toBaseUnits } from './shared/units.js'

// Keypair resolution (public — consumers may need this)
export { resolveKeypair } from './shared/keypairs.js'

// Env parsing (public)
export * as Env from './env.js'

// Logger interface (public — consumers need the type to pass loggers)
export type { Logger } from './shared/logger.js'
```

> Note: `resolveKeypair` remains a public export since SDK consumers use it to resolve keypair inputs for their own server configurations.

> Note: `Logger` type is exported so consumers can type their logger implementations.

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

Create `sdk/src/shared/` with extracted and new utilities. These are internal — not exported from the package (except `resolveKeypair`, `Logger` type, and unit helpers re-exported from root `index.ts`).

Each shared module gets its own colocated test file.

**`shared/poll.ts` — Transaction polling:**
- `pollTransaction(rpcServer, hash, opts?)` — replaces 6 inline polling loops across the codebase
- Handles all RPC response statuses: `SUCCESS` (return), `FAILED` (throw with details), `NOT_FOUND` (retry), RPC errors (throw immediately)
- Options: `maxAttempts` (default 30), `delayMs` (default 1000), `backoffMultiplier` (default 1.2), `jitterMs` (default 200), `timeoutMs` (default 30_000)
- Exponential backoff with random jitter
- AbortSignal support
- Test: `shared/poll.test.ts`

> Note: This is specifically for `getTransaction` polling. The `Watcher.ts` event polling (`getEvents`) is a different pattern and is NOT replaced by this utility.

> Note: The charge hash verification path currently uses 10 max attempts while all others use 60. The new default of 30 is a deliberate normalization. Individual callers can override via `maxAttempts`.

**`shared/fee-bump.ts` — Fee bump wrapping:**
- `wrapFeeBump(tx, signer, opts?)` — replaces 4 inline blocks in charge server, channel server (close, open), and standalone `close()` function
- Options: `maxFeeStroops` (default 10_000_000)
- Handles both Transaction and FeeBumpTransaction inputs
- Test: `shared/fee-bump.test.ts`

**`shared/validation.ts` — Input validation:**
- `validateHexSignature(hex, expectedLength?)` — replaces duplicated regex checks in channel server (voucher and open paths)
- `validateAmount(amount)` — validates BigInt string before conversion
- Test: `shared/validation.test.ts`

**`shared/keypairs.ts` — Keypair resolution:**
- `resolveKeypair(input: Keypair | string)` — handles Keypair instance and S... secret string
- Replaces `signers.ts` with same behavior, new location
- Test: `shared/keypairs.test.ts` (migrated from `signers.test.ts`)

> Note: Raw hex ed25519 seed handling is NOT added to `resolveKeypair`. The channel client's `commitmentSecret` / `commitmentKey` parameter uses `Keypair.fromRawEd25519Seed()` which is a distinct operation (ed25519 raw seed vs Stellar secret key encoding). This stays inline in the channel client as it's specific to commitment key semantics.

**`shared/scval.ts`** — Moved from root `sdk/src/scval.ts`. Same code, new location. No dedicated test file exists today — `scval` is tested implicitly through charge and channel integration tests. Exempt from the "each shared module gets its own test" rule.

**`shared/simulate.ts` — Simulation wrapper:**
- `simulateCall(rpcServer, tx, opts?)` — wraps `simulateTransaction()` with timeout
- Timeout implemented via `Promise.race` with `AbortController` — the RPC promise races against a timeout timer. On timeout, the AbortController cancels the underlying fetch if supported.
- Error classification (all extend `Error`):
  - `SimulationContractError` — contract reverted; carries `error` string from simulation result
  - `SimulationNetworkError` — RPC unreachable or non-simulation error; carries original error
  - `SimulationTimeoutError` — simulation did not complete within `timeoutMs`
- Options: `timeoutMs` (default 10_000)
- Test: `shared/simulate.test.ts`

**`shared/errors.ts` — Shared error base class:**
- `StellarMppError` extends `Error` with `details` record
- `PaymentVerificationError` and `ChannelVerificationError` both extend `StellarMppError`
- Consolidates the currently duplicated error class pattern
- Test: `shared/errors.test.ts`

**`shared/logger.ts` — Logger interface:**

```ts
export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}
```

- Pino-compatible — consumers pass their own instance
- Not a dependency of the SDK

**`shared/defaults.ts` — Internal defaults:**

> Named `defaults.ts` (not `constants.ts`) to avoid confusion with the public `sdk/src/constants.ts`.

```ts
export const DEFAULT_MAX_FEE_BUMP_STROOPS = 10_000_000
export const DEFAULT_POLL_MAX_ATTEMPTS = 30
export const DEFAULT_POLL_DELAY_MS = 1_000
export const DEFAULT_POLL_BACKOFF_MULTIPLIER = 1.2
export const DEFAULT_POLL_JITTER_MS = 200
export const DEFAULT_POLL_TIMEOUT_MS = 30_000
export const DEFAULT_SIMULATION_TIMEOUT_MS = 10_000
```

**`shared/units.ts`** — `toBaseUnits()` and `fromBaseUnits()` moved from `Methods.ts`. Re-exported from root `index.ts` and charge `Methods.ts` to preserve public API.

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

Breaking change — acceptable at 0.2.0 (pre-production). No migration script needed; any existing store data from 0.1.0 development is not expected to persist into 0.2.0.

> Note: Steps 3 and 5 both touch the charge/channel server files. Do them sequentially to avoid merge conflicts.

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

**Channel server `channel(parameters)` — same new fields plus existing channel-specific params:**

```ts
export function channel({
  channel: channelAddress,
  commitmentKey: commitmentKeyParam,
  signer: signerParam,
  feeBumpSigner: feeBumpSignerParam,
  checkOnChainState = false,
  onDisputeDetected,
  sourceAccount: sourceAccountParam,
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
}: channel.Parameters) {
```

**Charge client `charge(parameters)` — lighter set (polls in push mode only):**
- `pollMaxAttempts`, `pollDelayMs`, `pollTimeoutMs`, `simulationTimeoutMs`

**Channel client `channel(parameters)` — simulation timeout only:**
- `simulationTimeoutMs`

**The standalone `close()` function** in channel server also accepts `maxFeeBumpStroops`, `pollMaxAttempts`, `pollDelayMs`, `pollTimeoutMs`, `logger` — it has its own fee bump and polling loops that use the shared utilities.

---

### Step 5: Cleanups

**Dynamic import fix:**
- `channel/client/Channel.ts`: replace `await import('@stellar/stellar-sdk')` with static import at top of file, matching all other files

**Keypair standardization:**
- Charge client and server use `resolveKeypair()` from `shared/keypairs.ts` for `keypair`/`secretKey` and `signer` parameters
- Channel server uses `resolveKeypair()` for `signer` and `feeBumpSigner` parameters
- Channel client keeps inline `Keypair.fromRawEd25519Seed()` for `commitmentSecret` — this is ed25519-specific, not the same as Stellar secret key resolution

**Error message prefixes:**
- Charge errors: `"[stellar:charge] ..."`
- Channel errors: `"[stellar:channel] ..."`
- Helps identify which payment mode generated the error in logs

**Error class consolidation:**
- `PaymentVerificationError` and `ChannelVerificationError` both extend `StellarMppError` from `shared/errors.ts`
- Each keeps its own name for catch-block specificity

**`toBaseUnits` / `fromBaseUnits` relocation:**
- Move to `shared/units.ts`
- Re-export from root `index.ts` and charge `Methods.ts` to preserve public API

---

### Step 6: Robustness

**Polling (via `shared/poll.ts`):**
- Exponential backoff: delay = `delayMs * backoffMultiplier^attempt`
- Random jitter: `± jitterMs` added to each delay
- Wall-clock timeout: `timeoutMs` (default 30s) caps total polling time
- All 6 inline polling loops replaced (charge hash path, charge tx path, charge client push mode, channel close, channel open, standalone close function)

**Simulation (via `shared/simulate.ts`):**
- Timeout: `simulationTimeoutMs` (default 10s) on each `simulateTransaction()` call
- Implemented via `Promise.race` with `AbortController` — races simulation promise against timeout timer
- Error classification:
  - `SimulationContractError` — contract reverted (user/logic error)
  - `SimulationNetworkError` — RPC unreachable or returned non-simulation error
  - `SimulationTimeoutError` — simulation did not complete in time
- Better error messages with parsed revert details when available

**Logger integration:**
- Server-side only (charge server + channel server + standalone `close()`)
- Used for: tx rebuild/broadcast events, poll progress, fee bump wrapping, signature verification, store operations, on-chain state checks
- Errors logged at `warn`/`error` before throwing
- Clients use `onProgress` callbacks instead (already exist)

---

### Step 7: Pino in Example Servers

**New devDependencies:** `pino`, `pino-http`

> Note: These are devDependencies only — used in example files run via `tsx`. Not a peer dependency or runtime dependency of the SDK.

**Both `examples/server.ts` and `examples/channel-server.ts`:**
- Create pino instance
- Use `pino-http` middleware for request logging
- Pass pino logger to `stellar.charge()` / `stellar.channel()` as `logger` option
- Shows recommended production pattern

**Update `examples/config/charge-server.ts` and `examples/config/channel-server.ts`:**
- Add `logLevel` env var getter (defaults to `'info'`)

---

### Step 8: Docs + Version Bump

**package.json:**
- Version: `0.1.0` → `0.2.0`
- Exports: updated per Step 1

**README.md:**
- Update all import paths to new structure (`stellar-mpp-sdk/charge/client`, etc.)
- Update exports table (remove `stellar-mpp-sdk/client`, `stellar-mpp-sdk/server`)
- Update project structure tree
- Add configurable options section (polling, fee bump, timeouts, logger)
- Update server/client options tables with new parameters
- Show pino integration example
- Note breaking changes from 0.1.0

**CLAUDE.md:**
- Update module map with `shared/`, `charge/`
- Update subpath exports
- Note `shared/` convention (internal, not exported except `resolveKeypair`, `Logger` type, unit helpers)
- Update key patterns section

---

### Step 9: Review Gates

**Acceptance criteria:**
- All tests pass (`pnpm test -- --run`)
- No type errors (`pnpm check:types`)
- No lint errors (`pnpm lint`)
- Formatting clean (`pnpm format:check`)
- Build succeeds (`pnpm build`)
- No `any` casts added (existing warnings only)

**Reviews:**
1. `/review` — code quality, consistency, adherence to spec
2. `/security-review` — security headers, env handling, timeouts, error exposure
