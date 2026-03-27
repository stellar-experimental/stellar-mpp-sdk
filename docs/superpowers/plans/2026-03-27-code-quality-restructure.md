# Code Quality & Restructure — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the SDK for symmetry (charge/ folder), extract shared utilities, add robustness (polling backoff, simulation timeouts, error classification), and bump to 0.2.0.

**Architecture:** Move charge code from root into `charge/` folder matching `channel/` structure. Extract 6 duplicated patterns into `sdk/src/shared/`. Make magic numbers configurable via function parameters. Add pino logging to example servers. Breaking changes acceptable at pre-1.0.

**Tech Stack:** TypeScript, Vitest, @stellar/stellar-sdk, mppx, pino

**Spec:** `docs/superpowers/specs/2026-03-27-code-quality-restructure-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `sdk/src/shared/defaults.ts` | Internal default constants (poll, fee bump, simulation) |
| `sdk/src/shared/logger.ts` | Logger interface + noopLogger |
| `sdk/src/shared/errors.ts` | StellarMppError base class + PaymentVerificationError + ChannelVerificationError |
| `sdk/src/shared/errors.test.ts` | Error class tests |
| `sdk/src/shared/units.ts` | toBaseUnits() + fromBaseUnits() extracted from Methods.ts |
| `sdk/src/shared/keypairs.ts` | resolveKeypair() moved from signers.ts |
| `sdk/src/shared/keypairs.test.ts` | Migrated from signers.test.ts |
| `sdk/src/shared/validation.ts` | validateHexSignature() + validateAmount() |
| `sdk/src/shared/validation.test.ts` | Validation tests |
| `sdk/src/shared/simulate.ts` | simulateCall() with timeout + error classification |
| `sdk/src/shared/simulate.test.ts` | Simulation wrapper tests |
| `sdk/src/shared/poll.ts` | pollTransaction() with backoff + jitter |
| `sdk/src/shared/poll.test.ts` | Polling tests |
| `sdk/src/shared/fee-bump.ts` | wrapFeeBump() |
| `sdk/src/shared/fee-bump.test.ts` | Fee bump tests |
| `sdk/src/charge/Methods.ts` | Charge Zod schema (moved from root) |
| `sdk/src/charge/index.ts` | Charge root exports |
| `sdk/src/charge/client/` | Charge client (moved from root client/) |
| `sdk/src/charge/server/` | Charge server (moved from root server/) |

### Moved files

| From | To |
|------|-----|
| `sdk/src/Methods.ts` | `sdk/src/charge/Methods.ts` |
| `sdk/src/Methods.test.ts` | `sdk/src/charge/Methods.test.ts` |
| `sdk/src/client/*` | `sdk/src/charge/client/*` |
| `sdk/src/server/*` | `sdk/src/charge/server/*` |
| `sdk/src/integration.test.ts` | `sdk/src/charge/integration.test.ts` |
| `sdk/src/scval.ts` | `sdk/src/shared/scval.ts` |
| `sdk/src/signers.ts` | `sdk/src/shared/keypairs.ts` (expanded) |
| `sdk/src/signers.test.ts` | `sdk/src/shared/keypairs.test.ts` |

### Modified files

| File | Changes |
|------|---------|
| `sdk/src/index.ts` | Rewrite: new export structure (ChargeMethods, Logger type, units from shared) |
| `sdk/src/charge/server/Charge.ts` | Replace inline polling/fee-bump/verification with shared utils, add configurable params, update store keys, add logger, error prefixes |
| `sdk/src/charge/client/Charge.ts` | Replace inline polling with shared util, add configurable params, use resolveKeypair |
| `sdk/src/channel/server/Channel.ts` | Replace inline polling/fee-bump/validation with shared utils, add configurable params, update store keys (finalized→closed), add logger, error prefixes, fix error classes |
| `sdk/src/channel/client/Channel.ts` | Fix dynamic import, add simulationTimeoutMs param |
| `sdk/src/channel/server/State.ts` | Update import path for scval |
| `sdk/src/channel/server/Watcher.ts` | Update import path for scval |
| `sdk/src/channel/server/index.ts` | Update import for resolveKeypair |
| `package.json` | Version 0.2.0, updated exports |
| `examples/server.ts` | Add pino + pino-http |
| `examples/channel-server.ts` | Add pino + pino-http |
| `README.md` | Updated paths, exports, options tables, pino example |
| `CLAUDE.md` | Updated module map, commands, patterns |

### Deleted files

| File | Reason |
|------|--------|
| `sdk/src/Methods.ts` | Moved to `sdk/src/charge/Methods.ts` |
| `sdk/src/Methods.test.ts` | Moved to `sdk/src/charge/Methods.test.ts` |
| `sdk/src/client/` (entire dir) | Moved to `sdk/src/charge/client/` |
| `sdk/src/server/` (entire dir) | Moved to `sdk/src/charge/server/` |
| `sdk/src/scval.ts` | Moved to `sdk/src/shared/scval.ts` |
| `sdk/src/signers.ts` | Replaced by `sdk/src/shared/keypairs.ts` |
| `sdk/src/signers.test.ts` | Replaced by `sdk/src/shared/keypairs.test.ts` |
| `sdk/src/integration.test.ts` | Moved to `sdk/src/charge/integration.test.ts` |

---

## Task 1: Shared Foundation Modules

Create the simple shared modules that have no dependencies on the rest of the codebase. These are foundational and must exist before other shared modules or refactoring tasks.

> **Important:** During Tasks 1-5, the old files (`sdk/src/signers.ts`, `sdk/src/scval.ts`, `sdk/src/Methods.ts`, etc.) remain untouched and in use. The shared modules are purely additive — no existing code references them yet. Task 6 performs the file moves and import path updates. Do NOT delete or modify old files during Tasks 1-5.

### Files
- Create: `sdk/src/shared/defaults.ts`
- Create: `sdk/src/shared/logger.ts`
- Create: `sdk/src/shared/errors.ts`
- Create: `sdk/src/shared/errors.test.ts`
- Create: `sdk/src/shared/units.ts`

- [ ] **Step 1: Create `sdk/src/shared/defaults.ts`**

```ts
export const DEFAULT_MAX_FEE_BUMP_STROOPS = 10_000_000
export const DEFAULT_POLL_MAX_ATTEMPTS = 30
export const DEFAULT_POLL_DELAY_MS = 1_000
export const DEFAULT_POLL_BACKOFF_MULTIPLIER = 1.2
export const DEFAULT_POLL_JITTER_MS = 200
export const DEFAULT_POLL_TIMEOUT_MS = 30_000
export const DEFAULT_SIMULATION_TIMEOUT_MS = 10_000
```

- [ ] **Step 2: Create `sdk/src/shared/logger.ts`**

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

- [ ] **Step 3: Write failing tests for errors**

Create `sdk/src/shared/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  StellarMppError,
  PaymentVerificationError,
  ChannelVerificationError,
} from './errors.js'

describe('StellarMppError', () => {
  it('stores message and details', () => {
    const err = new StellarMppError('test error', { key: 'value' })
    expect(err.message).toBe('test error')
    expect(err.details).toEqual({ key: 'value' })
    expect(err).toBeInstanceOf(Error)
  })

  it('defaults details to empty object', () => {
    const err = new StellarMppError('test')
    expect(err.details).toEqual({})
  })
})

describe('PaymentVerificationError', () => {
  it('extends StellarMppError', () => {
    const err = new PaymentVerificationError('payment failed', { hash: 'abc' })
    expect(err).toBeInstanceOf(StellarMppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PaymentVerificationError')
    expect(err.details).toEqual({ hash: 'abc' })
  })
})

describe('ChannelVerificationError', () => {
  it('extends StellarMppError', () => {
    const err = new ChannelVerificationError('channel failed', { channel: 'C...' })
    expect(err).toBeInstanceOf(StellarMppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ChannelVerificationError')
    expect(err.details).toEqual({ channel: 'C...' })
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/shared/errors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement `sdk/src/shared/errors.ts`**

```ts
export class StellarMppError extends Error {
  public readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = this.constructor.name
    this.details = details
  }
}

export class PaymentVerificationError extends StellarMppError {}

export class ChannelVerificationError extends StellarMppError {}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/shared/errors.test.ts
```

Expected: All PASS.

- [ ] **Step 7: Create `sdk/src/shared/units.ts`**

Extract `toBaseUnits` and `fromBaseUnits` from the current `sdk/src/Methods.ts` (lines 70-97). Copy the two functions verbatim — they have no dependencies other than standard JS.

```ts
export function toBaseUnits(amount: string, decimals: number): string {
  // ... exact copy from Methods.ts lines 70-78
}

export function fromBaseUnits(baseUnits: string, decimals: number): string {
  // ... exact copy from Methods.ts lines 88-97
}
```

- [ ] **Step 8: Run format and lint**

```bash
pnpm format && pnpm lint
```

- [ ] **Step 9: Commit**

```bash
git add sdk/src/shared/
git commit -m "feat: add shared foundation modules (defaults, logger, errors, units)"
```

---

## Task 2: Shared Keypairs + Validation

### Files
- Create: `sdk/src/shared/keypairs.ts`
- Create: `sdk/src/shared/keypairs.test.ts`
- Create: `sdk/src/shared/validation.ts`
- Create: `sdk/src/shared/validation.test.ts`

- [ ] **Step 1: Write failing tests for keypairs**

Create `sdk/src/shared/keypairs.test.ts` — migrate content from `sdk/src/signers.test.ts`, updating the import path from `'./signers.js'` to `'./keypairs.js'`. Keep the same test cases (Keypair passthrough, S... string conversion).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/shared/keypairs.test.ts
```

- [ ] **Step 3: Implement `sdk/src/shared/keypairs.ts`**

Same logic as current `sdk/src/signers.ts` — `resolveKeypair(input: Keypair | string): Keypair`. Import `Keypair` from `@stellar/stellar-sdk`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/shared/keypairs.test.ts
```

- [ ] **Step 5: Write failing tests for validation**

Create `sdk/src/shared/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateHexSignature, validateAmount } from './validation.js'

describe('validateHexSignature', () => {
  it('accepts valid 128-char hex signature', () => {
    const sig = 'a'.repeat(128)
    expect(() => validateHexSignature(sig)).not.toThrow()
  })

  it('throws on wrong length', () => {
    expect(() => validateHexSignature('abcd')).toThrow()
  })

  it('throws on non-hex characters', () => {
    expect(() => validateHexSignature('z'.repeat(128))).toThrow()
  })

  it('throws on odd-length hex', () => {
    expect(() => validateHexSignature('a'.repeat(127))).toThrow()
  })

  it('accepts custom expected length', () => {
    expect(() => validateHexSignature('abcd1234', 8)).not.toThrow()
  })
})

describe('validateAmount', () => {
  it('accepts valid BigInt string', () => {
    expect(() => validateAmount('1000000')).not.toThrow()
  })

  it('accepts zero', () => {
    expect(() => validateAmount('0')).not.toThrow()
  })

  it('throws on non-numeric string', () => {
    expect(() => validateAmount('abc')).toThrow()
  })

  it('throws on negative', () => {
    expect(() => validateAmount('-100')).toThrow()
  })

  it('throws on empty string', () => {
    expect(() => validateAmount('')).toThrow()
  })

  it('throws on decimal', () => {
    expect(() => validateAmount('1.5')).toThrow()
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/shared/validation.test.ts
```

- [ ] **Step 7: Implement `sdk/src/shared/validation.ts`**

```ts
export function validateHexSignature(hex: string, expectedLength: number = 128): void {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0 || hex.length !== expectedLength) {
    throw new Error(
      `Invalid signature: expected ${expectedLength} hex characters, got ${hex.length}`,
    )
  }
}

export function validateAmount(amount: string): void {
  if (!/^\d+$/.test(amount)) {
    throw new Error(`Invalid amount: "${amount}" must be a non-negative integer string`)
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/shared/validation.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add sdk/src/shared/keypairs.ts sdk/src/shared/keypairs.test.ts sdk/src/shared/validation.ts sdk/src/shared/validation.test.ts
git commit -m "feat: add shared keypairs and validation utilities"
```

---

## Task 3: Shared Simulate

### Files
- Create: `sdk/src/shared/simulate.ts`
- Create: `sdk/src/shared/simulate.test.ts`

- [ ] **Step 1: Write failing tests for simulateCall**

Create `sdk/src/shared/simulate.test.ts`. Test cases:

1. Returns simulation result on success
2. Throws `SimulationContractError` when simulation has error field (contract revert)
3. Throws `SimulationNetworkError` when RPC call throws
4. Throws `SimulationTimeoutError` when simulation exceeds timeout
Mock `rpc.Server` and `rpc.Api.isSimulationSuccess`.

> Note: `rpc.Server.simulateTransaction()` may not accept AbortSignal natively. Use `Promise.race` with a timeout timer for the timeout mechanism. Do not assume AbortSignal support in the RPC client.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/shared/simulate.test.ts
```

- [ ] **Step 3: Implement `sdk/src/shared/simulate.ts`**

Key implementation details:
- `simulateCall(rpcServer, tx, opts?)` where opts has `timeoutMs` (default `DEFAULT_SIMULATION_TIMEOUT_MS` = 10_000)
- Use `Promise.race` between `rpcServer.simulateTransaction(tx)` and a timeout promise
- On timeout, throw `SimulationTimeoutError`
- On simulation failure (`!isSimulationSuccess`), throw `SimulationContractError` with the error string
- On network error (catch block), throw `SimulationNetworkError` wrapping the original error
- Export all 3 error classes (they extend `Error`, not `StellarMppError` — these are infrastructure errors, not verification errors)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/shared/simulate.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add sdk/src/shared/simulate.ts sdk/src/shared/simulate.test.ts
git commit -m "feat: add simulateCall with timeout and error classification"
```

---

## Task 4: Shared Poll

### Files
- Create: `sdk/src/shared/poll.ts`
- Create: `sdk/src/shared/poll.test.ts`

- [ ] **Step 1: Write failing tests for pollTransaction**

Create `sdk/src/shared/poll.test.ts`. Test cases:

1. Returns result on immediate SUCCESS
2. Retries on NOT_FOUND then succeeds
3. Throws on FAILED status with transaction error details
4. Throws on max attempts exceeded
5. Throws on wall-clock timeout exceeded
6. Applies exponential backoff (verify delay increases between attempts)
7. Throws immediately on RPC error (not NOT_FOUND)
8. Supports AbortSignal cancellation

Mock `rpc.Server.getTransaction()`.

Use `vi.useFakeTimers()` for testing backoff/timeout without real delays.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/shared/poll.test.ts
```

- [ ] **Step 3: Implement `sdk/src/shared/poll.ts`**

Key implementation details:
- `pollTransaction(rpcServer, hash, opts?)` — opts: `maxAttempts`, `delayMs`, `backoffMultiplier`, `jitterMs`, `timeoutMs` (all with defaults from `shared/defaults.ts`)
- Loop: call `rpcServer.getTransaction(hash)`, check status
  - `SUCCESS` → return result
  - `FAILED` → throw with error details from result
  - `NOT_FOUND` → wait with backoff, retry
  - Any RPC error → throw immediately
- Delay calculation: `delayMs * backoffMultiplier^attempt + random(-jitterMs, +jitterMs)`
- Wall-clock timeout: track start time, throw `PollTimeoutError` if `Date.now() - start > timeoutMs`
- AbortSignal: check before each iteration

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/shared/poll.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add sdk/src/shared/poll.ts sdk/src/shared/poll.test.ts
git commit -m "feat: add pollTransaction with exponential backoff and jitter"
```

---

## Task 5: Shared Fee Bump

### Files
- Create: `sdk/src/shared/fee-bump.ts`
- Create: `sdk/src/shared/fee-bump.test.ts`

- [ ] **Step 1: Write failing tests for wrapFeeBump**

Create `sdk/src/shared/fee-bump.test.ts`. Test cases:

1. Wraps a Transaction in FeeBumpTransaction signed by signer
2. Caps fee at maxFeeStroops (10x base fee, capped)
3. Skips wrapping if tx is already a FeeBumpTransaction (charge server pattern)
4. Uses custom maxFeeStroops when provided
5. Requires networkPassphrase parameter

Mock `Keypair`, `Transaction`, `FeeBumpTransaction`, `TransactionBuilder`.

Reference the current inline fee bump logic at `sdk/src/server/Charge.ts` lines 204-214 and `sdk/src/channel/server/Channel.ts` lines 364-374 for the exact pattern to extract.

> Note: The charge server **skips** fee bump when tx is already FeeBumpTransaction. The channel open path **unwraps** an existing FeeBumpTransaction to get innerTransaction before building a new fee bump. The `wrapFeeBump` utility should handle the common case (skip if already FeeBumpTransaction). The channel open path's unwrap-and-rewrap is a caller responsibility — it should extract the inner tx before calling `wrapFeeBump`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/shared/fee-bump.test.ts
```

- [ ] **Step 3: Implement `sdk/src/shared/fee-bump.ts`**

Key implementation details:
- `wrapFeeBump(tx, signer, opts)` — opts requires `networkPassphrase: string` and optional `maxFeeStroops` (default `DEFAULT_MAX_FEE_BUMP_STROOPS`)
- If tx is already FeeBumpTransaction, return as-is (skip wrapping)
- Calculate fee: `Math.min(Number(tx.fee) * 10, maxFeeStroops).toString()`
- Build FeeBumpTransaction via `TransactionBuilder.buildFeeBumpTransaction(signer, fee, tx, networkPassphrase)`
- Sign with signer keypair
- Return signed FeeBumpTransaction

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/shared/fee-bump.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add sdk/src/shared/fee-bump.ts sdk/src/shared/fee-bump.test.ts
git commit -m "feat: add wrapFeeBump utility with configurable max fee"
```

---

## Task 6: Directory Restructure

Move charge code from root into `charge/` folder. Move scval to shared. This is a large mechanical task — many file moves and import path updates.

### Files
- Move: `sdk/src/Methods.ts` → `sdk/src/charge/Methods.ts`
- Move: `sdk/src/Methods.test.ts` → `sdk/src/charge/Methods.test.ts`
- Move: `sdk/src/client/*` → `sdk/src/charge/client/*`
- Move: `sdk/src/server/*` → `sdk/src/charge/server/*`
- Move: `sdk/src/integration.test.ts` → `sdk/src/charge/integration.test.ts`
- Move: `sdk/src/scval.ts` → `sdk/src/shared/scval.ts`
- Delete: `sdk/src/signers.ts`, `sdk/src/signers.test.ts` (replaced by shared/keypairs)
- Create: `sdk/src/charge/index.ts`
- Modify: `sdk/src/index.ts` (new root exports)
- Modify: `package.json` (exports, version)
- Modify: All channel files that import from `../scval.js` or `../../signers.js`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p sdk/src/charge/client sdk/src/charge/server
```

- [ ] **Step 2: Move charge files using git mv**

```bash
git mv sdk/src/Methods.ts sdk/src/charge/Methods.ts
git mv sdk/src/Methods.test.ts sdk/src/charge/Methods.test.ts
git mv sdk/src/client/Charge.ts sdk/src/charge/client/Charge.ts
git mv sdk/src/client/Charge.test.ts sdk/src/charge/client/Charge.test.ts
git mv sdk/src/client/Methods.ts sdk/src/charge/client/Methods.ts
git mv sdk/src/client/index.ts sdk/src/charge/client/index.ts
git mv sdk/src/server/Charge.ts sdk/src/charge/server/Charge.ts
git mv sdk/src/server/Charge.test.ts sdk/src/charge/server/Charge.test.ts
git mv sdk/src/server/Methods.ts sdk/src/charge/server/Methods.ts
git mv sdk/src/server/index.ts sdk/src/charge/server/index.ts
git mv sdk/src/integration.test.ts sdk/src/charge/integration.test.ts
git mv sdk/src/scval.ts sdk/src/shared/scval.ts
```

- [ ] **Step 3: Delete old signers files**

```bash
git rm sdk/src/signers.ts sdk/src/signers.test.ts
```

- [ ] **Step 4: Remove empty old directories**

```bash
rmdir sdk/src/client sdk/src/server
```

- [ ] **Step 5: Create `sdk/src/charge/index.ts`**

Read the current `sdk/src/channel/index.ts` for the pattern. Create the charge equivalent:

```ts
export { charge } from './Methods.js'
```

- [ ] **Step 6: Update `sdk/src/index.ts` — new root exports**

Replace entire file with the content from the spec:

```ts
// Schemas
export * as ChargeMethods from './charge/Methods.js'
export * as ChannelMethods from './channel/Methods.js'

// Constants (public)
export {
  DEFAULT_DECIMALS,
  DEFAULT_FEE,
  DEFAULT_TIMEOUT,
  HORIZON_URLS,
  NETWORK_PASSPHRASE,
  SAC_ADDRESSES,
  SOROBAN_RPC_URLS,
  USDC_SAC_MAINNET,
  USDC_SAC_TESTNET,
  XLM_SAC_MAINNET,
  XLM_SAC_TESTNET,
  ALL_ZEROS,
  type NetworkId,
} from './constants.js'

// Unit conversion (public, moved from Methods.ts)
export { fromBaseUnits, toBaseUnits } from './shared/units.js'

// Keypair resolution (public)
export { resolveKeypair } from './shared/keypairs.js'

// Env parsing (public)
export * as Env from './env.js'

// Logger interface (public — consumers need the type)
export type { Logger } from './shared/logger.js'
```

- [ ] **Step 7: Update package.json exports and version**

Replace the `"exports"` field:

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  },
  "./charge": {
    "types": "./dist/charge/index.d.ts",
    "default": "./dist/charge/index.js"
  },
  "./charge/client": {
    "types": "./dist/charge/client/index.d.ts",
    "default": "./dist/charge/client/index.js"
  },
  "./charge/server": {
    "types": "./dist/charge/server/index.d.ts",
    "default": "./dist/charge/server/index.js"
  },
  "./channel": {
    "types": "./dist/channel/index.d.ts",
    "default": "./dist/channel/index.js"
  },
  "./channel/client": {
    "types": "./dist/channel/client/index.d.ts",
    "default": "./dist/channel/client/index.js"
  },
  "./channel/server": {
    "types": "./dist/channel/server/index.d.ts",
    "default": "./dist/channel/server/index.js"
  },
  "./env": {
    "types": "./dist/env.d.ts",
    "default": "./dist/env.js"
  }
}
```

Update version: `"version": "0.2.0"`

- [ ] **Step 8: Update all import paths in moved charge files**

Files to update (all under `sdk/src/charge/`):
- `Methods.ts`: imports from `../constants.js` → same (already correct relative to charge/)
  - But `toBaseUnits`/`fromBaseUnits` are still defined here — update to re-export from `../shared/units.js`
- `client/Charge.ts`: update imports:
  - `'../constants.js'` → `'../../constants.js'`
  - `'../Methods.js'` → `'../Methods.js'` (same, now relative to charge/)
  - `'../scval.js'` → `'../../shared/scval.js'`
  - Note: charge client does NOT import signers.js — it uses inline `Keypair.fromSecret()` which will be replaced with `resolveKeypair()` in Task 7
- `client/Methods.ts`: `'./Charge.js'` stays, `'../Methods.js'` → `'../Methods.js'` (stays)
- `server/Charge.ts`: update imports similarly:
  - `'../constants.js'` → `'../../constants.js'`
  - `'../Methods.js'` → `'../Methods.js'`
  - `'../scval.js'` → `'../../shared/scval.js'`
  - `'../signers.js'` → `'../../shared/keypairs.js'`
- `server/Methods.ts`: same pattern
- `server/index.ts`: `'../signers.js'` → `'../../shared/keypairs.js'`

- [ ] **Step 9: Update import paths in channel files that reference moved modules**

Files under `sdk/src/channel/` that import scval or signers:
- `server/Channel.ts`: `'../../scval.js'` → `'../../shared/scval.js'`, `'../../signers.js'` → `'../../shared/keypairs.js'`
- `server/State.ts`: `'../../scval.js'` → `'../../shared/scval.js'`
- `server/Watcher.ts`: `'../../scval.js'` → `'../../shared/scval.js'`
- `server/index.ts`: `'../../signers.js'` → `'../../shared/keypairs.js'`

- [ ] **Step 10: Update import paths in test files**

All moved test files need their imports updated:
- `charge/Methods.test.ts`: `'./Methods.js'` stays
- `charge/client/Charge.test.ts`: imports may reference `'../Methods.js'` etc. — update relative paths
- `charge/server/Charge.test.ts`: same
- `charge/integration.test.ts`: update all imports from `'./client/index.js'` to `'./client/index.js'` (should be same), `'./server/index.js'` to `'./server/index.js'`, and `'./Methods.js'` stays
- Channel test files that import scval: update paths

- [ ] **Step 11: Update import paths in example files**

All example files under `examples/` import from `'../sdk/src/...'`:
- `server.ts`: `'../sdk/src/server/index.js'` → `'../sdk/src/charge/server/index.js'`, `'../sdk/src/client/index.js'` → `'../sdk/src/charge/client/index.js'`
- `client.ts`: `'../sdk/src/client/index.js'` → `'../sdk/src/charge/client/index.js'`
- `channel-server.ts`: `'../sdk/src/channel/server/index.js'` stays
- `channel-client.ts`: `'../sdk/src/channel/client/index.js'` stays
- `channel-open.ts`: stays
- `channel-close.ts`: `'../sdk/src/channel/server/index.js'` stays, `'../sdk/src/constants.js'` stays

- [ ] **Step 12: Verify everything compiles and tests pass**

```bash
pnpm format && pnpm lint && pnpm check:types && pnpm test -- --run
```

Fix any broken imports until all 172+ tests pass.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: move charge code into charge/ folder, restructure shared utilities"
```

---

## Task 7: Refactor Charge Server + Client

Replace inline patterns in charge implementation with shared utilities. Add configurable parameters, store key updates, error prefixes, logger integration, and keypair standardization.

### Files
- Modify: `sdk/src/charge/server/Charge.ts`
- Modify: `sdk/src/charge/client/Charge.ts`
- Modify: `sdk/src/charge/Methods.ts` (re-export units from shared)

- [ ] **Step 1: Update charge/Methods.ts to re-export from shared/units**

In `sdk/src/charge/Methods.ts`, the `toBaseUnits` and `fromBaseUnits` functions are currently defined inline. Replace them with re-exports:

1. Remove the function implementations
2. Add: `export { toBaseUnits, fromBaseUnits } from '../shared/units.js'`
3. Keep the Zod schema and Method.from() definition unchanged

- [ ] **Step 2: Refactor charge server — add imports and configurable params**

In `sdk/src/charge/server/Charge.ts`:

1. Add new imports:
   ```ts
   import { pollTransaction } from '../../shared/poll.js'
   import { wrapFeeBump } from '../../shared/fee-bump.js'
   import { resolveKeypair } from '../../shared/keypairs.js'
   import { PaymentVerificationError } from '../../shared/errors.js'
   import { noopLogger, type Logger } from '../../shared/logger.js'
   import {
     DEFAULT_MAX_FEE_BUMP_STROOPS,
     DEFAULT_POLL_MAX_ATTEMPTS,
     DEFAULT_POLL_DELAY_MS,
     DEFAULT_POLL_TIMEOUT_MS,
     DEFAULT_SIMULATION_TIMEOUT_MS,
   } from '../../shared/defaults.js'
   ```

2. Add new parameters to the `charge` function destructuring with explicit defaults:
   ```ts
   maxFeeBumpStroops = DEFAULT_MAX_FEE_BUMP_STROOPS,
   pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
   pollDelayMs = DEFAULT_POLL_DELAY_MS,
   pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
   simulationTimeoutMs = DEFAULT_SIMULATION_TIMEOUT_MS,
   logger = noopLogger,
   ```

3. Update the Parameters namespace type to include the new fields

4. Remove the inline `PaymentVerificationError` class (now imported from shared/errors). Note: the shared version uses `Record<string, unknown>` for `details` (widened from the current `Record<string, string>`) — this is backwards-compatible but update any type assertions if needed

- [ ] **Step 3: Refactor charge server — replace inline polling**

Replace all inline `while (txResult.status === 'NOT_FOUND')` loops with `pollTransaction()`:

1. **Hash verification path** (~line 98-120): Replace the `while` loop and retry logic with:
   ```ts
   const txResult = await pollTransaction(rpcServer, credential.payload.hash, {
     maxAttempts: pollMaxAttempts,
     delayMs: pollDelayMs,
     timeoutMs: pollTimeoutMs,
   })
   ```

2. **Transaction broadcast path** (~line 220-229): Replace with same pattern

- [ ] **Step 4: Refactor charge server — replace inline fee bump**

Replace the inline fee bump block (~lines 204-214) with:
```ts
if (feeBumpSignerKeypair) {
  prepared = wrapFeeBump(prepared, feeBumpSignerKeypair, {
    maxFeeStroops: maxFeeBumpStroops,
    networkPassphrase,
  })
}
```

- [ ] **Step 5: Refactor charge server — update store keys**

Replace store key strings:
- `stellar:tx:${hash}` → `stellar:charge:hash:${hash}`
- `stellar:challenge:${challengeId}` → `stellar:charge:challenge:${challengeId}`

Search for all `store.get` and `store.put` calls and update the key strings.

- [ ] **Step 6: Refactor charge server — add error prefixes and logger calls**

1. Prefix all error messages with `[stellar:charge]`
2. Add logger calls at key points:
   - `logger.debug('[stellar:charge] Rebuilding sponsored tx with signer account')`
   - `logger.debug('[stellar:charge] Broadcasting tx', { hash })`
   - `logger.debug('[stellar:charge] Fee bump wrapping', { fee })`
   - `logger.warn('[stellar:charge] Verification failed', { error })` before throws

- [ ] **Step 7: Refactor charge client — add configurable params**

In `sdk/src/charge/client/Charge.ts`:

1. Add configurable parameters: `pollMaxAttempts`, `pollDelayMs`, `pollTimeoutMs`, `simulationTimeoutMs`
2. Replace inline polling loop in push mode path with `pollTransaction()`
3. Use `resolveKeypair()` from `shared/keypairs.js` instead of inline `Keypair.fromSecret(secretKey!)`

- [ ] **Step 8: Verify all tests pass**

```bash
pnpm format && pnpm lint && pnpm check:types && pnpm test -- --run
```

Fix any issues. The existing charge tests should still pass with the refactored internals.

- [ ] **Step 9: Commit**

```bash
git add sdk/src/charge/
git commit -m "refactor: charge server+client use shared utils, configurable params, new store keys"
```

---

## Task 8: Refactor Channel Server + Client

Replace inline patterns in channel implementation with shared utilities. Add configurable parameters, store key updates (finalized→closed), error prefixes, logger integration, fix dynamic import.

### Files
- Modify: `sdk/src/channel/server/Channel.ts`
- Modify: `sdk/src/channel/client/Channel.ts`

- [ ] **Step 1: Refactor channel server — add imports and configurable params**

In `sdk/src/channel/server/Channel.ts`:

1. Add new imports (same pattern as charge server):
   ```ts
   import { pollTransaction } from '../../shared/poll.js'
   import { wrapFeeBump } from '../../shared/fee-bump.js'
   import { validateHexSignature } from '../../shared/validation.js'
   import { resolveKeypair } from '../../shared/keypairs.js'
   import { ChannelVerificationError } from '../../shared/errors.js'
   import { noopLogger, type Logger } from '../../shared/logger.js'
   import { DEFAULT_MAX_FEE_BUMP_STROOPS, ... } from '../../shared/defaults.js'
   ```

2. Add configurable params with explicit defaults (same as charge server + `simulationTimeoutMs`)

3. Update Parameters namespace

4. Remove inline `ChannelVerificationError` class

- [ ] **Step 2: Refactor channel server — rename finalized → closed**

Global find-and-replace in `sdk/src/channel/server/Channel.ts`:
- `finalized` → `closed` (variable names)
- `stellar:channel:finalized:` → `stellar:channel:closed:`
- `'Channel has been finalized'` → `'Channel has been closed'`
- `finalizedAt` → `closedAt`

Also update `stellar:challenge:` → `stellar:channel:challenge:` for channel replay protection keys.

- [ ] **Step 3: Refactor channel server — replace inline polling (3 locations)**

1. **Close action** (~lines 378-390): Replace with `pollTransaction()`
2. **Open action** (~lines 554-566): Replace with `pollTransaction()`
3. **Standalone `close()` function** (~lines 662-673): Replace with `pollTransaction()`

All use the configurable polling params.

- [ ] **Step 4: Refactor channel server — replace inline fee bump (3 locations)**

1. **Close action** (~lines 364-374): Replace with `wrapFeeBump()`
2. **Open action** (~lines 539-551): Replace with `wrapFeeBump()`
3. **Standalone `close()` function** (~lines 646-657): Replace with `wrapFeeBump()`

- [ ] **Step 5: Refactor channel server — replace inline hex validation**

Replace the duplicated regex checks in:
1. **Voucher/close path** (~lines 231-238): Replace with `validateHexSignature(signatureHex)`
2. **Open path** (~lines 440-444): Replace with `validateHexSignature(signatureHex)`

- [ ] **Step 6: Refactor channel server — add error prefixes and logger calls**

1. Prefix all error messages with `[stellar:channel]`
2. Add logger calls at key points:
   - Commitment verification steps
   - On-chain state checks
   - Close/open transaction broadcasting
   - Store operations
   - `logger.warn` before all throws

- [ ] **Step 7: Refactor channel server — update standalone close() params**

The standalone `close()` function should also accept configurable params:
- `maxFeeBumpStroops`, `pollMaxAttempts`, `pollDelayMs`, `pollTimeoutMs`, `logger`

- [ ] **Step 8: Refactor channel client — fix dynamic import + add simulationTimeoutMs**

In `sdk/src/channel/client/Channel.ts`:

1. Replace line ~96 `const { TransactionBuilder } = await import('@stellar/stellar-sdk')` with a static import at the top of the file
2. Add `simulationTimeoutMs` parameter with default from `DEFAULT_SIMULATION_TIMEOUT_MS`
3. Update Parameters namespace

- [ ] **Step 9: Verify all tests pass**

```bash
pnpm format && pnpm lint && pnpm check:types && pnpm test -- --run
```

The existing channel tests should still pass. The channel server tests at `sdk/src/channel/server/Channel.test.ts` (946 lines) will need store key assertion updates:
- `stellar:channel:finalized:` → `stellar:channel:closed:` in all mock expectations
- `stellar:challenge:` → `stellar:channel:challenge:` in channel replay protection assertions
- `finalizedAt` → `closedAt` in stored value assertions

Search for all occurrences of these strings in the test file and update them.

- [ ] **Step 10: Commit**

```bash
git add sdk/src/channel/
git commit -m "refactor: channel server+client use shared utils, finalized→closed, configurable params"
```

---

## Task 9: Pino in Example Servers

### Files
- Modify: `examples/server.ts`
- Modify: `examples/channel-server.ts`
- Modify: `examples/config/charge-server.ts`
- Modify: `examples/config/channel-server.ts`

- [ ] **Step 1: Install pino dependencies**

```bash
pnpm add -D pino pino-http @types/pino-http
```

- [ ] **Step 2: Add logLevel to Env config classes**

In `examples/config/charge-server.ts`, add:

```ts
static get logLevel(): string {
  return parseOptional('LOG_LEVEL', 'info')!
}
```

Same in `examples/config/channel-server.ts`.

- [ ] **Step 3: Update examples/server.ts with pino**

Add imports:
```ts
import pino from 'pino'
import pinoHttp from 'pino-http'
```

Create logger after Env setup:
```ts
const logger = pino({ level: Env.logLevel })
```

Add pino-http middleware:
```ts
app.use(pinoHttp({ logger }))
```

Pass logger to stellar.charge():
```ts
stellar.charge({
  recipient: Env.stellarRecipient,
  currency: USDC_SAC_TESTNET,
  network: 'testnet',
  logger,
})
```

- [ ] **Step 4: Update examples/channel-server.ts with pino**

Same pattern as charge server.

- [ ] **Step 5: Update .env.example files**

Add `LOG_LEVEL=info` to both `examples/.env.charge-server.example` and `examples/.env.channel-server.example`.

- [ ] **Step 6: Format and lint**

```bash
pnpm format && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add examples/ package.json pnpm-lock.yaml
git commit -m "feat: add pino logging to example servers"
```

---

## Task 10: Documentation Updates

### Files
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md**

Key changes:
1. Update all import paths in code examples: `stellar-mpp-sdk/client` → `stellar-mpp-sdk/charge/client`, `stellar-mpp-sdk/server` → `stellar-mpp-sdk/charge/server`
2. Update exports table — remove `stellar-mpp-sdk/client` and `stellar-mpp-sdk/server`, add `stellar-mpp-sdk/charge`, `stellar-mpp-sdk/charge/client`, `stellar-mpp-sdk/charge/server`
3. Update project structure tree to show `charge/`, `shared/` folders
4. Add configurable options section showing polling, fee bump, timeout, and logger parameters
5. Add pino integration example
6. Note breaking changes from 0.1.0 → 0.2.0
7. Update server/client options tables with new parameters (maxFeeBumpStroops, pollMaxAttempts, etc.)

- [ ] **Step 2: Update CLAUDE.md**

Key changes:
1. Update module map with `shared/` entries (defaults, logger, errors, units, keypairs, validation, simulate, poll, fee-bump, scval)
2. Add `charge/` to module map (Methods.ts, client/Charge.ts, server/Charge.ts)
3. Update subpath exports list
4. Note `shared/` convention (internal, except resolveKeypair, Logger type, units)
5. Add key patterns: shared utility extraction, configurable defaults, Logger interface
6. Update commands if any changed

- [ ] **Step 3: Format**

```bash
pnpm format
```

- [ ] **Step 4: Verify full pipeline**

```bash
make check
```

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for 0.2.0 restructure"
```

---

## Task 11: Review Gates

- [ ] **Step 1: Run full pipeline verification**

```bash
pnpm format:check && pnpm lint && pnpm check:types && pnpm test -- --run && pnpm build
```

All must pass.

- [ ] **Step 2: Run /review**

Invoke `/review` to check code quality, consistency, and adherence to the spec.

- [ ] **Step 3: Fix any issues from review**

Address feedback and commit fixes.

- [ ] **Step 4: Run /security-review**

Invoke `/security-review` to audit timeouts, error exposure, env handling, and logger safety.

- [ ] **Step 5: Fix any issues from security review**

Address feedback and commit fixes.

- [ ] **Step 6: Final verification**

```bash
make check
```

Expected: Full pipeline passes.
