# Productionalize stellar-mpp-sdk — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-grade tooling, CI/CD, security headers, env parsing, and developer experience to the stellar-mpp-sdk codebase.

**Architecture:** Layered approach — tooling config first, then dependency upgrades, then env parser, then Express migration, then Makefile/CI/docs. Each layer is verified before the next builds on it.

**Tech Stack:** ESLint 9 + typescript-eslint, Prettier, Express + helmet + cors + express-rate-limit, GitHub Actions, Makefile, Vitest

**Spec:** `docs/superpowers/specs/2026-03-26-productionalize-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `eslint.config.mjs` | ESLint 9 flat config for TypeScript |
| `.prettierrc` | Prettier formatting rules |
| `.prettierignore` | Files excluded from Prettier |
| `.git-blame-ignore-revs` | Ignore formatting commit in git blame |
| `sdk/src/env.ts` | Stellar-aware env parsing primitives |
| `sdk/src/env.test.ts` | Tests for env primitives |
| `examples/config/charge-server.ts` | Env class for charge server example |
| `examples/config/charge-client.ts` | Env class for charge client example |
| `examples/config/channel-server.ts` | Env class for channel server example |
| `examples/config/channel-client.ts` | Env class for channel client example |
| `Makefile` | Self-documenting dev workflow targets |
| `examples/.env.charge-server.example` | Env template for charge server |
| `examples/.env.charge-client.example` | Env template for charge client |
| `examples/.env.channel-server.example` | Env template for channel server |
| `examples/.env.channel-client.example` | Env template for channel client |
| `.github/workflows/ci.yml` | GitHub Actions CI pipeline |

### Modified files

| File | Changes |
|------|---------|
| `package.json` | scripts, packageManager, engines, exports, devDependencies, dependencies |
| `tsconfig.json` | Add `noImplicitReturns` |
| `.gitignore` | Add `examples/.env.*`, `!examples/.env.*.example` |
| `sdk/src/index.ts` | Re-export env module |
| `examples/server.ts` | Rewrite: raw http → Express + helmet + cors + rate-limit + Env class |
| `examples/channel-server.ts` | Rewrite: raw http → Express + helmet + cors + rate-limit + Env class |
| `examples/client.ts` | Use Env class for env parsing |
| `examples/channel-client.ts` | Use Env class for env parsing |
| `examples/channel-open.ts` | Use env primitives for inline validation |
| `examples/channel-close.ts` | Use env primitives for inline validation |
| `README.md` | Prerequisites, dev workflow, structure tree, env docs, export table |
| `CLAUDE.md` | Commands, module map, tooling notes |

---

## Task 1: ESLint + Prettier + Config (Spec Step 1)

### Files
- Create: `eslint.config.mjs`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `.git-blame-ignore-revs`
- Modify: `package.json` (scripts, packageManager, engines)
- Modify: `tsconfig.json:3` (add noImplicitReturns)
- Modify: `.gitignore` (add examples/.env.*)

- [ ] **Step 1: Add packageManager, engines, and new scripts to package.json**

Add these fields to `package.json`:

```json
"packageManager": "pnpm@10.33.0",
"engines": {
  "node": ">=22"
},
```

Add these to the `"scripts"` section:

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 2: Add noImplicitReturns to tsconfig.json**

In `tsconfig.json`, add `"noImplicitReturns": true` to `compilerOptions` (after `"isolatedModules": true` on line 16):

```json
"isolatedModules": true,
"noImplicitReturns": true
```

- [ ] **Step 3: Update .gitignore**

Append to `.gitignore`:

```
examples/.env.*
!examples/.env.*.example
```

- [ ] **Step 4: Install ESLint + Prettier devDependencies**

```bash
pnpm add -D eslint @eslint/js typescript-eslint prettier
```

- [ ] **Step 5: Create eslint.config.mjs**

Create `eslint.config.mjs`:

```js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['sdk/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['examples/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'demo/', '**/*.test.ts'],
  },
)
```

> Note: Type-aware rules (via `projectService`) only apply to `sdk/src/` files which are in `tsconfig.json`. Example files get basic rules without type-checking since they are not part of the tsconfig project. Test files are ignored because they use vi.mock with dynamic patterns.

- [ ] **Step 6: Create .prettierrc**

Create `.prettierrc`:

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

> This matches the existing code style: no semicolons, single quotes, trailing commas, 2-space indent.

- [ ] **Step 7: Create .prettierignore**

Create `.prettierignore`:

```
dist/
node_modules/
pnpm-lock.yaml
```

- [ ] **Step 8: Run Prettier to format the entire codebase**

```bash
pnpm format
```

Expected: Prettier reformats files to match the config. Some files may change (line width adjustments, trailing commas).

- [ ] **Step 9: Run ESLint and fix any issues**

```bash
pnpm lint
```

If there are errors, fix them. Common issues:
- Unused variables → prefix with `_` or remove
- `any` usage → add `// eslint-disable-next-line` if intentional, or type properly

Then run:

```bash
pnpm lint:fix
```

- [ ] **Step 10: Verify typecheck and tests still pass**

```bash
pnpm check:types && pnpm test -- --run
```

Expected: All checks pass.

- [ ] **Step 11: Commit tooling config**

```bash
git add eslint.config.mjs .prettierrc .prettierignore .gitignore tsconfig.json package.json pnpm-lock.yaml
git commit -m "chore: add ESLint 9, Prettier, tsconfig tweaks, packageManager"
```

- [ ] **Step 12: Commit formatting changes separately**

```bash
git add -A
git commit -m "style: format codebase with Prettier"
```

- [ ] **Step 13: Create .git-blame-ignore-revs**

Get the formatting commit hash:

```bash
git log --oneline -1
```

Create `.git-blame-ignore-revs` with the hash:

```
# Prettier initial formatting
<HASH_FROM_PREVIOUS_STEP>
```

```bash
git add .git-blame-ignore-revs
git commit -m "chore: add .git-blame-ignore-revs for Prettier formatting commit"
```

---

## Task 2: Dependency Upgrades (Spec Step 2)

### Files
- Modify: `package.json` (dependency versions)

- [ ] **Step 1: Upgrade devDependencies**

```bash
pnpm add -D typescript@latest vitest@latest tsx@latest @types/node@latest
```

- [ ] **Step 2: Verify devDep upgrades**

```bash
pnpm check:types && pnpm test -- --run
```

Expected: All pass. If type errors occur, fix them before proceeding.

- [ ] **Step 3: Upgrade runtime dependencies**

```bash
pnpm add zod@latest
pnpm add -D @stellar/stellar-sdk@latest mppx@latest
```

> Note: `@stellar/stellar-sdk` and `mppx` are peer dependencies listed in devDependencies for development.

- [ ] **Step 4: Verify runtime dep upgrades**

```bash
pnpm check:types && pnpm test -- --run
```

Expected: All pass. If Zod v4 or stellar-sdk introduced breaking changes, fix them.

- [ ] **Step 5: Ensure all versions use ^ prefix**

Open `package.json` and verify every version uses `^` prefix (not pinned). The `zod` entry was previously pinned to `4.3.6` — confirm it now reads `^4.x.x`.

- [ ] **Step 6: Install Express + security deps for later tasks**

```bash
pnpm add -D express @types/express helmet express-rate-limit cors @types/cors
```

- [ ] **Step 7: Verify everything still passes**

```bash
pnpm format:check && pnpm lint && pnpm check:types && pnpm test -- --run
```

Expected: Full pipeline passes.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade all dependencies to latest"
```

---

## Task 3: Env Parser (Spec Step 3)

### Files
- Create: `sdk/src/env.ts`
- Create: `sdk/src/env.test.ts`
- Modify: `sdk/src/index.ts` (re-export)
- Modify: `package.json` (add `./env` subpath export)

- [ ] **Step 1: Write the failing tests for env primitives**

Create `sdk/src/env.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseRequired,
  parseOptional,
  parsePort,
  parseStellarPublicKey,
  parseStellarSecretKey,
  parseContractAddress,
  parseHexKey,
  parseCommaSeparatedList,
  parseNumber,
} from './env.js'

describe('parseRequired', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns value when env var is set', () => {
    vi.stubEnv('TEST_VAR', 'hello')
    expect(parseRequired('TEST_VAR')).toBe('hello')
  })

  it('throws when env var is missing', () => {
    delete process.env.TEST_VAR
    expect(() => parseRequired('TEST_VAR')).toThrow('TEST_VAR is required')
  })

  it('throws when env var is empty string', () => {
    vi.stubEnv('TEST_VAR', '')
    expect(() => parseRequired('TEST_VAR')).toThrow('TEST_VAR is required')
  })
})

describe('parseOptional', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns value when set', () => {
    vi.stubEnv('TEST_VAR', 'hello')
    expect(parseOptional('TEST_VAR')).toBe('hello')
  })

  it('returns undefined when missing', () => {
    delete process.env.TEST_VAR
    expect(parseOptional('TEST_VAR')).toBeUndefined()
  })

  it('returns fallback when missing', () => {
    delete process.env.TEST_VAR
    expect(parseOptional('TEST_VAR', 'default')).toBe('default')
  })
})

describe('parsePort', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns default port when env var missing', () => {
    delete process.env.PORT
    expect(parsePort('PORT', 3000)).toBe(3000)
  })

  it('reads PORT from env', () => {
    vi.stubEnv('PORT', '8080')
    expect(parsePort('PORT', 3000)).toBe(8080)
  })

  it('throws on non-integer', () => {
    vi.stubEnv('PORT', 'abc')
    expect(() => parsePort('PORT', 3000)).toThrow('Invalid PORT')
  })

  it('throws on out-of-range port', () => {
    vi.stubEnv('PORT', '99999')
    expect(() => parsePort('PORT', 3000)).toThrow('Invalid PORT')
  })
})

describe('parseStellarPublicKey', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns valid G... key', () => {
    const key = 'GATLN2B5WYM6PV64X532ZNQ6Q22HVNFNOTH27VLYEHYLRLM5KNBWV2PL'
    vi.stubEnv('RECIPIENT', key)
    expect(parseStellarPublicKey('RECIPIENT')).toBe(key)
  })

  it('throws when missing', () => {
    delete process.env.RECIPIENT
    expect(() => parseStellarPublicKey('RECIPIENT')).toThrow('RECIPIENT is required')
  })

  it('throws on invalid format', () => {
    vi.stubEnv('RECIPIENT', 'SNOTAPUBLICKEY')
    expect(() => parseStellarPublicKey('RECIPIENT')).toThrow('must be a Stellar public key (G...)')
  })

  it('throws on wrong length', () => {
    vi.stubEnv('RECIPIENT', 'GSHORT')
    expect(() => parseStellarPublicKey('RECIPIENT')).toThrow('must be a Stellar public key (G...)')
  })
})

describe('parseStellarSecretKey', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns valid S... key', () => {
    const key = 'SA5KKLVMJWQNZU4I2PIT2DYLPR6VBB552EQGRZB2EKMPCYICGWH56YXP'
    vi.stubEnv('SECRET', key)
    expect(parseStellarSecretKey('SECRET')).toBe(key)
  })

  it('throws on invalid format', () => {
    vi.stubEnv('SECRET', 'GNOTASECRETKEY')
    expect(() => parseStellarSecretKey('SECRET')).toThrow('must be a Stellar secret key (S...)')
  })
})

describe('parseContractAddress', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns valid C... address', () => {
    const addr = 'CBU3P5BAU6CYGPAVY7TGGGNEPCS7H73IA3L677Z3CFZSGFYB7UFK4IMS'
    vi.stubEnv('CONTRACT', addr)
    expect(parseContractAddress('CONTRACT')).toBe(addr)
  })

  it('throws on invalid format', () => {
    vi.stubEnv('CONTRACT', 'GNOTACONTRACT')
    expect(() => parseContractAddress('CONTRACT')).toThrow('must be a contract address (C...)')
  })
})

describe('parseHexKey', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns valid 64-char hex key', () => {
    const hex = 'b83ee77019d9ca0aac432139fe0159ec01b5d31f58905fdc089980be05b7c5fd'
    vi.stubEnv('HEX_KEY', hex)
    expect(parseHexKey('HEX_KEY')).toBe(hex)
  })

  it('throws on wrong length', () => {
    vi.stubEnv('HEX_KEY', 'abcd')
    expect(() => parseHexKey('HEX_KEY')).toThrow('must be 64 hex characters')
  })

  it('throws on non-hex characters', () => {
    vi.stubEnv('HEX_KEY', 'zzzz' + '0'.repeat(60))
    expect(() => parseHexKey('HEX_KEY')).toThrow('must be 64 hex characters')
  })

  it('accepts custom length', () => {
    vi.stubEnv('SHORT_KEY', 'abcd1234')
    expect(parseHexKey('SHORT_KEY', 8)).toBe('abcd1234')
  })
})

describe('parseCommaSeparatedList', () => {
  it('splits comma-separated values', () => {
    expect(parseCommaSeparatedList('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace', () => {
    expect(parseCommaSeparatedList(' a , b , c ')).toEqual(['a', 'b', 'c'])
  })

  it('filters empty entries', () => {
    expect(parseCommaSeparatedList('a,,b,')).toEqual(['a', 'b'])
  })

  it('returns empty array for empty string', () => {
    expect(parseCommaSeparatedList('')).toEqual([])
  })
})

describe('parseNumber', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('returns value from env', () => {
    vi.stubEnv('NUM', '42')
    expect(parseNumber('NUM')).toBe(42)
  })

  it('returns fallback when missing', () => {
    delete process.env.NUM
    expect(parseNumber('NUM', { fallback: 10 })).toBe(10)
  })

  it('throws when missing with no fallback', () => {
    delete process.env.NUM
    expect(() => parseNumber('NUM')).toThrow('NUM is required')
  })

  it('throws on non-number', () => {
    vi.stubEnv('NUM', 'abc')
    expect(() => parseNumber('NUM')).toThrow('Invalid NUM')
  })

  it('validates min', () => {
    vi.stubEnv('NUM', '0')
    expect(() => parseNumber('NUM', { min: 1 })).toThrow('NUM must be >= 1')
  })

  it('validates max', () => {
    vi.stubEnv('NUM', '100')
    expect(() => parseNumber('NUM', { max: 50 })).toThrow('NUM must be <= 50')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --run sdk/src/env.test.ts
```

Expected: FAIL — module `./env.js` does not exist.

- [ ] **Step 3: Implement env.ts**

Create `sdk/src/env.ts`:

```ts
export function parseRequired(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function parseOptional(name: string, fallback?: string): string | undefined {
  const value = process.env[name]
  if (value !== undefined && value !== '') return value
  return fallback
}

export function parsePort(name: string = 'PORT', fallback?: number): number {
  const raw = process.env[name]
  if (!raw) {
    if (fallback !== undefined) return fallback
    throw new Error(`${name} is required`)
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}: ${raw}. Must be an integer between 1 and 65535.`)
  }
  return port
}

export function parseStellarPublicKey(name: string): string {
  const value = parseRequired(name)
  if (!value.startsWith('G') || value.length !== 56) {
    throw new Error(`${name} must be a Stellar public key (G..., 56 characters)`)
  }
  return value
}

export function parseStellarSecretKey(name: string): string {
  const value = parseRequired(name)
  if (!value.startsWith('S') || value.length !== 56) {
    throw new Error(`${name} must be a Stellar secret key (S..., 56 characters)`)
  }
  return value
}

export function parseContractAddress(name: string): string {
  const value = parseRequired(name)
  if (!value.startsWith('C') || value.length !== 56) {
    throw new Error(`${name} must be a contract address (C..., 56 characters)`)
  }
  return value
}

export function parseHexKey(name: string, length: number = 64): string {
  const value = parseRequired(name)
  const hexRegex = new RegExp(`^[0-9a-fA-F]{${length}}$`)
  if (!hexRegex.test(value)) {
    throw new Error(`${name} must be ${length} hex characters`)
  }
  return value
}

export function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseNumber(
  name: string,
  opts?: { min?: number; max?: number; fallback?: number },
): number {
  const raw = process.env[name]
  if (!raw) {
    if (opts?.fallback !== undefined) return opts.fallback
    throw new Error(`${name} is required`)
  }
  const num = Number(raw)
  if (isNaN(num)) {
    throw new Error(`Invalid ${name}: ${raw}. Must be a number.`)
  }
  if (opts?.min !== undefined && num < opts.min) {
    throw new Error(`${name} must be >= ${opts.min}`)
  }
  if (opts?.max !== undefined && num > opts.max) {
    throw new Error(`${name} must be <= ${opts.max}`)
  }
  return num
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --run sdk/src/env.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Add subpath export to package.json**

Add to the `"exports"` section in `package.json`, after the `"./channel/server"` entry:

```json
"./env": {
  "types": "./dist/env.d.ts",
  "default": "./dist/env.js"
}
```

- [ ] **Step 6: Re-export from sdk/src/index.ts**

Add to `sdk/src/index.ts`:

```ts
export * as Env from './env.js'
```

- [ ] **Step 7: Verify full pipeline**

```bash
pnpm format:check && pnpm lint && pnpm check:types && pnpm test -- --run
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add sdk/src/env.ts sdk/src/env.test.ts sdk/src/index.ts package.json
git commit -m "feat: add Stellar-aware env parsing primitives"
```

---

## Task 4: Example Env Config Classes (Spec Step 3)

### Files
- Create: `examples/config/charge-server.ts`
- Create: `examples/config/charge-client.ts`
- Create: `examples/config/channel-server.ts`
- Create: `examples/config/channel-client.ts`

- [ ] **Step 1: Create examples/config/charge-server.ts**

```ts
import {
  parseCommaSeparatedList,
  parseNumber,
  parseOptional,
  parsePort,
  parseStellarPublicKey,
} from '../../sdk/src/env.js'

export class Env {
  static get port(): number {
    return parsePort('PORT', 3000)
  }

  static get stellarRecipient(): string {
    return parseStellarPublicKey('STELLAR_RECIPIENT')
  }

  static get mppSecretKey(): string {
    return parseOptional('MPP_SECRET_KEY', 'stellar-mpp-demo-secret')!
  }

  static get corsOrigin(): string | string[] {
    const raw = parseOptional('CORS_ORIGIN', '*')!
    return raw === '*' ? '*' : parseCommaSeparatedList(raw)
  }

  static get rateLimitWindowMs(): number {
    return parseNumber('RATE_LIMIT_WINDOW_MS', { fallback: 60000, min: 1 })
  }

  static get rateLimitMax(): number {
    return parseNumber('RATE_LIMIT_MAX', { fallback: 100, min: 1 })
  }

  static get trustProxy(): string[] {
    const raw = parseOptional('TRUST_PROXY', 'loopback,linklocal,uniquelocal')!
    return parseCommaSeparatedList(raw)
  }
}
```

- [ ] **Step 2: Create examples/config/charge-client.ts**

```ts
import { parseOptional, parseStellarSecretKey } from '../../sdk/src/env.js'

export class Env {
  static get stellarSecret(): string {
    return parseStellarSecretKey('STELLAR_SECRET')
  }

  static get serverUrl(): string {
    return parseOptional('SERVER_URL', 'http://localhost:3000')!
  }
}
```

- [ ] **Step 3: Create examples/config/channel-server.ts**

```ts
import {
  parseCommaSeparatedList,
  parseContractAddress,
  parseHexKey,
  parseNumber,
  parseOptional,
  parsePort,
} from '../../sdk/src/env.js'

export class Env {
  static get port(): number {
    return parsePort('PORT', 3001)
  }

  static get channelContract(): string {
    return parseContractAddress('CHANNEL_CONTRACT')
  }

  static get commitmentPubkey(): string {
    return parseHexKey('COMMITMENT_PUBKEY')
  }

  static get mppSecretKey(): string {
    return parseOptional('MPP_SECRET_KEY', 'stellar-mpp-channel-demo-secret')!
  }

  static get sourceAccount(): string | undefined {
    return parseOptional('SOURCE_ACCOUNT')
  }

  static get corsOrigin(): string | string[] {
    const raw = parseOptional('CORS_ORIGIN', '*')!
    return raw === '*' ? '*' : parseCommaSeparatedList(raw)
  }

  static get rateLimitWindowMs(): number {
    return parseNumber('RATE_LIMIT_WINDOW_MS', { fallback: 60000, min: 1 })
  }

  static get rateLimitMax(): number {
    return parseNumber('RATE_LIMIT_MAX', { fallback: 100, min: 1 })
  }

  static get trustProxy(): string[] {
    const raw = parseOptional('TRUST_PROXY', 'loopback,linklocal,uniquelocal')!
    return parseCommaSeparatedList(raw)
  }
}
```

- [ ] **Step 4: Create examples/config/channel-client.ts**

```ts
import { parseHexKey, parseOptional } from '../../sdk/src/env.js'

export class Env {
  static get commitmentSecret(): string {
    return parseHexKey('COMMITMENT_SECRET')
  }

  static get serverUrl(): string {
    return parseOptional('SERVER_URL', 'http://localhost:3001')!
  }

  static get sourceAccount(): string | undefined {
    return parseOptional('SOURCE_ACCOUNT')
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add examples/config/
git commit -m "feat: add per-example Env config classes using env primitives"
```

---

## Task 5: Express Migration — Charge Server (Spec Step 4)

### Files
- Modify: `examples/server.ts` (full rewrite)

- [ ] **Step 1: Rewrite examples/server.ts with Express**

Replace the entire content of `examples/server.ts` with:

```ts
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
import { stellar } from '../sdk/src/server/index.js'
import { stellar as stellarClient } from '../sdk/src/client/index.js'
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
    const stack = err instanceof Error ? err.stack : undefined
    res.status(500).json({ error: message, stack })
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
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm check:types
```

Expected: PASS (examples are not included in tsconfig's `include` — they use tsx runtime). If there are issues with imports, verify the Env class paths are correct.

- [ ] **Step 3: Commit**

```bash
git add examples/server.ts
git commit -m "refactor: migrate charge server example to Express with security headers"
```

---

## Task 6: Express Migration — Channel Server (Spec Step 4)

### Files
- Modify: `examples/channel-server.ts` (full rewrite)

- [ ] **Step 1: Rewrite examples/channel-server.ts with Express**

Replace the entire content of `examples/channel-server.ts` with:

```ts
/**
 * Example: Stellar MPP Channel Server
 *
 * Charges per request via off-chain one-way payment channel commitments.
 * Uses Express with security headers (helmet, CORS, rate limiting).
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

import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { StrKey } from '@stellar/stellar-sdk'
import { Mppx, Store } from 'mppx/server'
import { stellar } from '../sdk/src/channel/server/index.js'
import { Env } from './config/channel-server.js'

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

// Convert the raw ed25519 public key (hex) to a Stellar G... address for verification
const commitmentPublicKeyG = StrKey.encodeEd25519PublicKey(
  Buffer.from(Env.commitmentPubkey, 'hex'),
)

const store = Store.memory()

const mppx = Mppx.create({
  secretKey: Env.mppSecretKey,
  methods: [
    stellar.channel({
      channel: Env.channelContract,
      commitmentKey: commitmentPublicKeyG,
      sourceAccount: Env.sourceAccount,
      store,
      network: 'testnet',
    }),
  ],
})

// Main MPP channel endpoint — catch-all so every route is payment-gated (matches original behavior)
app.use(async (req, res) => {
  const webReq = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: new Headers(req.headers as Record<string, string>),
  })

  const result = await mppx.channel({
    amount: '0.1',
    description: 'Channel-gated API access',
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
      message: 'Payment verified via channel commitment — here is your content.',
      timestamp: new Date().toISOString(),
      note: 'No on-chain transaction was needed for this payment!',
    }),
  )
  res.status(receipt.status)
  receipt.headers.forEach((v, k) => res.setHeader(k, v))
  res.send(await receipt.text())
})

app.listen(Env.port, () => {
  console.log(`🚀 Stellar MPP Channel server running on http://localhost:${Env.port}`)
  console.log(`   Channel contract: ${Env.channelContract}`)
  console.log(`   Commitment key:   ${Env.commitmentPubkey.slice(0, 16)}...`)
  console.log(`   Charging 0.1 XLM per request (off-chain commitments)`)
})
```

- [ ] **Step 2: Commit**

```bash
git add examples/channel-server.ts
git commit -m "refactor: migrate channel server example to Express with security headers"
```

---

## Task 7: Update Client Examples + Standalone Scripts (Spec Steps 3-4)

### Files
- Modify: `examples/client.ts`
- Modify: `examples/channel-client.ts`
- Modify: `examples/channel-open.ts`
- Modify: `examples/channel-close.ts`

- [ ] **Step 1: Update examples/client.ts to use Env class**

Replace the inline env parsing (lines 15-19) in `examples/client.ts`:

```ts
const secretKey = process.env.STELLAR_SECRET
if (!secretKey) {
  console.error('Usage: STELLAR_SECRET=S... npx tsx examples/client.ts')
  process.exit(1)
}
```

With:

```ts
import { Env } from './config/charge-client.js'
```

(Add at top of file, after other imports.)

Then replace all references:
- `secretKey` → `Env.stellarSecret`
- `const keypair = Keypair.fromSecret(secretKey)` → `const keypair = Keypair.fromSecret(Env.stellarSecret)`
- `process.env.SERVER_URL ?? 'http://localhost:3000'` → `Env.serverUrl`

Remove the `if (!secretKey)` validation block — the Env class handles it.

- [ ] **Step 2: Update examples/channel-client.ts to use Env class**

Replace the inline env parsing (lines 15-19) in `examples/channel-client.ts`:

```ts
const commitmentSecret = process.env.COMMITMENT_SECRET
if (!commitmentSecret || commitmentSecret.length !== 64) {
  console.error('Usage: COMMITMENT_SECRET=<64-char-hex-ed25519-secret> npx tsx examples/channel-client.ts')
  process.exit(1)
}
```

With an import of the Env class and use:
- Add `import { Env } from './config/channel-client.js'` after other imports
- Replace `commitmentSecret` → `Env.commitmentSecret`
- Replace `process.env.SOURCE_ACCOUNT` → `Env.sourceAccount`
- Replace `process.env.SERVER_URL ?? 'http://localhost:3001'` → `Env.serverUrl`
- Remove the validation block

- [ ] **Step 3: Update examples/channel-open.ts to use env primitives**

Replace the inline validation in `examples/channel-open.ts` (lines 24-38) with env primitive imports:

Add at top:

```ts
import { parseHexKey, parseOptional, parseRequired } from '../sdk/src/env.js'
```

Replace:
- `process.env.OPEN_TX_XDR` + validation block → `parseRequired('OPEN_TX_XDR')`
- `process.env.COMMITMENT_SECRET` + validation block → `parseHexKey('COMMITMENT_SECRET')`
- `process.env.INITIAL_AMOUNT ?? '10000000'` → `parseOptional('INITIAL_AMOUNT', '10000000')!`
- `process.env.SERVER_URL ?? 'http://localhost:3001'` → `parseOptional('SERVER_URL', 'http://localhost:3001')!`
- `process.env.SOURCE_ACCOUNT` → `parseOptional('SOURCE_ACCOUNT')`

Remove the `if (!OPEN_TX_XDR)` and `if (!COMMITMENT_SECRET)` blocks.

- [ ] **Step 4: Update examples/channel-close.ts to use env primitives**

Replace the inline validation in `examples/channel-close.ts` (lines 29-48) with env primitive imports:

Add at top:

```ts
import {
  parseContractAddress,
  parseHexKey,
  parseOptional,
  parseStellarSecretKey,
} from '../sdk/src/env.js'
```

Replace:
- `process.env.CHANNEL_CONTRACT` + validation → `parseContractAddress('CHANNEL_CONTRACT')`
- `process.env.COMMITMENT_SECRET` + validation → `parseHexKey('COMMITMENT_SECRET')`
- `process.env.CLOSE_SECRET` + validation → `parseStellarSecretKey('CLOSE_SECRET')`
- `BigInt(process.env.AMOUNT ?? '2000000')` → `BigInt(parseOptional('AMOUNT', '2000000')!)` (keep as BigInt from string to avoid precision loss with large amounts)

Remove the three `if` validation blocks.

- [ ] **Step 5: Run lint and format**

```bash
pnpm format && pnpm lint
```

Fix any issues.

- [ ] **Step 6: Commit**

```bash
git add examples/client.ts examples/channel-client.ts examples/channel-open.ts examples/channel-close.ts
git commit -m "refactor: use Env classes and env primitives in all example scripts"
```

---

## Task 8: Makefile (Spec Step 5)

### Files
- Create: `Makefile`

- [ ] **Step 1: Create Makefile**

Create `Makefile` at the project root:

```makefile
.PHONY: install build clean typecheck lint lint-fix format format-check test test-watch check \
        demo-server demo-client demo-channel-server demo-channel-client help

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install dependencies
	pnpm install

build: ## Compile TypeScript → dist/
	pnpm run build

clean: ## Remove dist/ and node_modules/
	rm -rf dist node_modules

typecheck: ## Type-check without emitting (tsc --noEmit)
	pnpm run check:types

lint: ## Run ESLint
	pnpm run lint

lint-fix: ## Run ESLint with auto-fix
	pnpm run lint:fix

format: ## Format code with Prettier
	pnpm run format

format-check: ## Check formatting (CI-friendly)
	pnpm run format:check

test: ## Run tests once (vitest --run)
	pnpm test -- --run

test-watch: ## Run tests in watch mode
	pnpm test

check: install format-check lint typecheck test build ## Run full quality pipeline (mirrors CI)

demo-server: ## Run charge server example
	pnpm run demo:server

demo-client: ## Run charge client example
	pnpm run demo:client

demo-channel-server: ## Run channel server example
	pnpm run demo:channel-server

demo-channel-client: ## Run channel client example
	pnpm run demo:channel-client

.DEFAULT_GOAL := help
```

- [ ] **Step 2: Verify make help**

```bash
make help
```

Expected: Formatted list of all targets with descriptions.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "chore: add self-documenting Makefile for dev workflow"
```

---

## Task 9: .env.example Files (Spec Step 6)

### Files
- Create: `examples/.env.charge-server.example`
- Create: `examples/.env.charge-client.example`
- Create: `examples/.env.channel-server.example`
- Create: `examples/.env.channel-client.example`

- [ ] **Step 1: Create examples/.env.charge-server.example**

```env
# Charge Server Configuration
PORT=3000
STELLAR_RECIPIENT=G_YOUR_STELLAR_PUBLIC_KEY_HERE
MPP_SECRET_KEY=your-mpp-secret-key

# Security
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
TRUST_PROXY=loopback,linklocal,uniquelocal
```

- [ ] **Step 2: Create examples/.env.charge-client.example**

```env
# Charge Client Configuration
STELLAR_SECRET=S_YOUR_STELLAR_SECRET_KEY_HERE
SERVER_URL=http://localhost:3000
```

- [ ] **Step 3: Create examples/.env.channel-server.example**

```env
# Channel Server Configuration
PORT=3001
CHANNEL_CONTRACT=C_YOUR_CHANNEL_CONTRACT_ADDRESS_HERE
COMMITMENT_PUBKEY=your_64_hex_char_ed25519_public_key_here
MPP_SECRET_KEY=your-mpp-secret-key
SOURCE_ACCOUNT=G_YOUR_SOURCE_ACCOUNT_HERE

# Security
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
TRUST_PROXY=loopback,linklocal,uniquelocal
```

- [ ] **Step 4: Create examples/.env.channel-client.example**

```env
# Channel Client Configuration
COMMITMENT_SECRET=your_64_hex_char_ed25519_secret_key_here
SERVER_URL=http://localhost:3001
SOURCE_ACCOUNT=G_YOUR_SOURCE_ACCOUNT_HERE
```

> Note: The `.env` file with testnet keys is NOT currently tracked in git (verified via `git ls-files`). It is already in `.gitignore`. No removal action needed.

- [ ] **Step 5: Verify .env.example files are tracked but .env.* are not**

```bash
git status
```

Expected: The `.example` files show as untracked (to be added). No other `.env.*` files should appear.

- [ ] **Step 6: Commit**

```bash
git add examples/.env.*.example
git commit -m "docs: add .env.example files for all demo configurations"
```

---

## Task 10: GitHub Actions CI (Spec Step 7)

### Files
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create .github/workflows/ci.yml**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.head_ref || github.run_id }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check-test-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '22'

      - name: Setup pnpm via corepack
        run: |
          corepack enable
          corepack install

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Check formatting
        run: pnpm format:check

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm check:types

      - name: Test
        run: pnpm test -- --run

      - name: Build
        run: pnpm build

  complete:
    if: always()
    needs: [check-test-build]
    runs-on: ubuntu-latest
    steps:
      - name: Check status
        run: |
          if [ "${{ needs.check-test-build.result }}" != "success" ]; then
            echo "CI failed or was cancelled"
            exit 1
          fi
```

> Note: `actions/checkout` and `actions/setup-node` are pinned to SHAs for supply chain security. The setup-node step runs twice: first to enable corepack (before pnpm is available for caching), then again to set up pnpm caching.

- [ ] **Step 2: Verify YAML syntax**

```bash
cat .github/workflows/ci.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin.read()); print('Valid YAML')"
```

Expected: `Valid YAML`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions pipeline with quality gates"
```

---

## Task 11: README.md + CLAUDE.md Updates (Spec Step 8)

### Files
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md**

Make the following changes to `README.md`:

1. **Add Prerequisites section** (after "## Install", before the install command):

```markdown
## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10.33+ (via [corepack](https://nodejs.org/api/corepack.html))

```bash
corepack enable
```
```

2. **Update Install section** to include corepack:

```markdown
## Install

```bash
corepack enable
pnpm install
```
```

3. **Add Development section** (before or after "## Demo"):

```markdown
## Development

```bash
make help       # Show all available commands
make check      # Run full quality pipeline (format, lint, typecheck, test, build)
make test       # Run tests once
make test-watch # Run tests in watch mode
```

See the [Makefile](Makefile) for all targets.
```

4. **Update the exports table** to include `stellar-mpp-sdk/env`:

Add a row:
```
| `stellar-mpp-sdk/env` | `parseRequired`, `parseOptional`, `parsePort`, `parseStellarPublicKey`, `parseStellarSecretKey`, `parseContractAddress`, `parseHexKey`, `parseCommaSeparatedList`, `parseNumber` |
```

5. **Add Environment variables section** referencing .env.example files:

```markdown
## Environment variables

Example `.env` files are provided for each demo:

| File | Purpose |
|------|---------|
| `examples/.env.charge-server.example` | Charge server (recipient key, security settings) |
| `examples/.env.charge-client.example` | Charge client (secret key, server URL) |
| `examples/.env.channel-server.example` | Channel server (contract, commitment key, security) |
| `examples/.env.channel-client.example` | Channel client (commitment secret, server URL) |

Copy the relevant `.example` file, remove the `.example` suffix, and fill in your values.
```

6. **Update Project structure** to include new files: `eslint.config.mjs`, `.prettierrc`, `Makefile`, `.github/`, `examples/config/`, `sdk/src/env.ts`

7. **Update server examples references** to mention Express + security middleware where the charge/channel server descriptions appear.

- [ ] **Step 2: Update CLAUDE.md**

Make the following changes to `CLAUDE.md`:

1. **Add to Commands section:**

```markdown
pnpm run lint           # Run ESLint
pnpm run format:check   # Check Prettier formatting
make help               # Show all Makefile targets
make check              # Run full quality pipeline (mirrors CI)
```

2. **Add to Module Map table:**

```markdown
| `sdk/src/env.ts` | Stellar-aware env parsing primitives (parsePort, parseStellarPublicKey, etc.) |
| `examples/config/*.ts` | Per-example Env classes using env primitives |
```

3. **Add to Key Patterns:**

```markdown
- **Express + security headers**: Example servers use Express with helmet, CORS, and rate limiting middleware. Env vars configure CORS origins, rate limits, and trust proxy.
- **Env parsing**: Published as `stellar-mpp-sdk/env`. Core primitives read from `process.env` with validation. Per-example `Env` classes compose these into static getters.
```

4. **Add tooling note at the end:**

```markdown
### Tooling

- **ESLint 9** flat config (`eslint.config.mjs`) with typescript-eslint recommended rules
- **Prettier** for formatting (`.prettierrc`), separate from ESLint
- **GitHub Actions** CI runs: format-check → lint → typecheck → test → build
- **Makefile** for dev workflow (`make help` for all targets, `make check` mirrors CI)
```

- [ ] **Step 3: Run format on updated docs**

```bash
pnpm format
```

- [ ] **Step 4: Verify full pipeline one last time**

```bash
make check
```

Expected: Full pipeline passes (install → format-check → lint → typecheck → test → build).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for productionalization changes"
```

---

## Task 12: Review Gates (Spec Step 9)

- [ ] **Step 1: Run /review**

Invoke `/review` to check code quality, consistency, and adherence to the spec.

- [ ] **Step 2: Fix any issues from review**

Address feedback and commit fixes.

- [ ] **Step 3: Run /security-review**

Invoke `/security-review` to audit security headers, env handling, dependency versions, CI config, and exposed secrets.

- [ ] **Step 4: Fix any issues from security review**

Address feedback and commit fixes.

- [ ] **Step 5: Final verification**

```bash
make check
```

Expected: Full pipeline passes.
