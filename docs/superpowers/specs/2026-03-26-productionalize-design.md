# Productionalize stellar-mpp-sdk

**Date:** 2026-03-26
**Status:** Approved
**Branch:** chore/productionalize

## Goal

Add production-grade tooling, CI/CD, security, and developer experience to the stellar-mpp-sdk codebase. Reference: [stellar/x402-stellar](https://github.com/stellar/x402-stellar).

## Implementation Steps

Steps are ordered by dependency — each layer is stable before the next builds on it.

---

### Step 1: Tooling Configuration

**ESLint 9 (flat config):**
- Create `eslint.config.mjs` at root using `@eslint/js` + `typescript-eslint`
- Target `sdk/src/**/*.ts` and `examples/**/*.ts`
- Ignore `dist/`, `node_modules/`, `demo/`
- Use recommended defaults from typescript-eslint; add targeted overrides if the first lint pass surfaces false positives (e.g., `@typescript-eslint/no-unused-vars` with underscore prefix convention)

**Prettier:**
- Create `.prettierrc` at root with minimal config (semi, singleQuote, trailingComma — matching current code style)
- Create `.prettierignore` for `dist/`, `node_modules/`, `pnpm-lock.yaml`
- Separate from ESLint — no `eslint-plugin-prettier`
- After the initial format pass, create `.git-blame-ignore-revs` with the formatting commit hash to preserve clean `git blame` history

**tsconfig tweaks:**
- Add `noImplicitReturns: true`

**packageManager + engines:**
- Add `"packageManager": "pnpm@10.33.0"` to `package.json` (latest available)
- Add `"engines": { "node": ">=22" }` to `package.json`
- Regenerate lockfile with pnpm 10.33.0

**.gitignore updates:**
- Add `examples/.env.*` (but not `*.example`) to `.gitignore`

**New scripts in package.json:**
```json
{
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

**Verification:** `pnpm lint` and `pnpm format:check` run without errors (after initial format pass).

---

### Step 2: Dependency Upgrades

Upgrade in two sub-steps to isolate breakage:

**Step 2a — devDependencies first:**

| Package | Current | Action |
|---------|---------|--------|
| `typescript` | `^5.8.0` | `^{latest}` |
| `vitest` | `^3.1.0` | `^{latest}` |
| `tsx` | `^4.21.0` | `^{latest}` |
| `@types/node` | `^25.5.0` | `^{latest}` |

Verify: `pnpm check:types` + `pnpm test -- --run`

**Step 2b — runtime dependencies:**

| Package | Current | Action |
|---------|---------|--------|
| `zod` | `4.3.6` (pinned) | `^{latest}` |
| `@stellar/stellar-sdk` | `^14.6.1` | `^{latest}` |
| `mppx` | `^0.4.7` | `^{latest}` |

Verify: `pnpm check:types` + `pnpm test -- --run`

**New devDependencies (all `^{latest}`):**

| Package | Purpose |
|---------|---------|
| `eslint` | Linting |
| `@eslint/js` | ESLint recommended rules |
| `typescript-eslint` | TypeScript ESLint integration |
| `prettier` | Formatting |
| `express` | Example servers |
| `@types/express` | Express types |
| `helmet` | Security headers |
| `express-rate-limit` | Rate limiting |
| `cors` | CORS middleware |
| `@types/cors` | CORS types |

---

### Step 3: Env Parser

Build env parsing before Express migration so the servers can use it from the start.

**Core primitives in `sdk/src/env.ts`** (exported from the package):

```ts
parseRequired(name: string): string
parseOptional(name: string, fallback?: string): string | undefined
parsePort(name?: string, fallback?: number): number
parseStellarPublicKey(name: string): string       // validates G..., 56 chars
parseStellarSecretKey(name: string): string       // validates S..., 56 chars
parseContractAddress(name: string): string        // validates C..., 56 chars
parseHexKey(name: string, length?: number): string // validates hex, default 64 chars
parseCommaSeparatedList(value: string): string[]   // pure utility — takes a raw string, not an env var name
parseNumber(name: string, opts?: { min?, max?, fallback? }): number
```

> **Design note:** These are Stellar-aware env primitives — useful to any Stellar app bootstrapping from env vars, not just our examples. Publishing them as `stellar-mpp-sdk/env` keeps them discoverable for SDK consumers building their own servers/clients without adding a separate package.

> **Note on `parseCommaSeparatedList`:** This is intentionally a pure string utility (takes a value, not an env var name) following x402-stellar's pattern. All other parsers read from `process.env` internally.

**Per-example Env classes** using those primitives:
- `examples/config/charge-server.ts` — PORT, STELLAR_RECIPIENT, MPP_SECRET_KEY, CORS_ORIGIN, RATE_LIMIT_*, TRUST_PROXY
- `examples/config/charge-client.ts` — STELLAR_SECRET, SERVER_URL
- `examples/config/channel-server.ts` — PORT, CHANNEL_CONTRACT, COMMITMENT_PUBKEY (via `parseHexKey`), MPP_SECRET_KEY, SOURCE_ACCOUNT, CORS_ORIGIN, RATE_LIMIT_*
- `examples/config/channel-client.ts` — COMMITMENT_SECRET (via `parseHexKey`), SERVER_URL, SOURCE_ACCOUNT

> **Note:** `channel-open.ts` and `channel-close.ts` are standalone scripts, not HTTP servers. They will be updated to use the env primitives for their inline validation, but do not get their own Env config classes.

**New subpath export** in `package.json`:
- `stellar-mpp-sdk/env` -> `dist/env.js` / `dist/env.d.ts`

**Tests:** `sdk/src/env.test.ts` — all core primitives using `vi.stubEnv()`.

---

### Step 4: Express Migration + Security Headers

**Migrate `examples/server.ts` and `examples/channel-server.ts` from raw Node `http.createServer` to Express.**

**Security middleware stack (matching x402-stellar):**
- `helmet()` — `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, etc.
- `cors()` — configurable via `CORS_ORIGIN` env var (default `*` for demos)
- `express-rate-limit` — configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` env vars
- Trust proxy config via `TRUST_PROXY` env var

**Both servers get identical middleware:**
```ts
app.set('trust proxy', Env.trustProxy)
app.use(helmet())
app.use(cors({ origin: Env.corsOrigin }))
app.use(rateLimit({ windowMs: Env.rateLimitWindowMs, max: Env.rateLimitMax }))
```

**Structure change:**
- Replace `http.createServer` + manual routing with Express `app.get()` / `app.post()`
- Replace manual CORS header logic with `cors()` middleware
- Replace inline env validation with Env class imports from `examples/config/`
- Keep the same routes and behavior

> **Note:** `helmet()` will add security headers (e.g., `X-Content-Type-Options: nosniff`) that the current servers do not set. This is intentional — the goal is improved security defaults for the examples.

---

### Step 5: Makefile

Self-documenting Makefile with `help` as default target:

```
install          ## Install dependencies
build            ## Compile TypeScript -> dist/
clean            ## Remove dist/ and node_modules/
typecheck        ## Type-check without emitting (tsc --noEmit)
lint             ## Run ESLint
lint-fix         ## Run ESLint with auto-fix
format           ## Format code with Prettier
format-check     ## Check formatting (CI-friendly)
test             ## Run tests once (vitest --run)
test-watch       ## Run tests in watch mode
check            ## Run full pipeline: install -> format-check -> lint -> typecheck -> test -> build
demo-server           ## Run charge server example
demo-client           ## Run charge client example
demo-channel-server   ## Run channel server example
demo-channel-client   ## Run channel client example
help             ## Show this help message (default target)
```

---

### Step 6: `.env.example` Files

Per-demo `.env.example` files with descriptive placeholders:

**`examples/.env.charge-server.example`**
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

**`examples/.env.charge-client.example`**
```env
# Charge Client Configuration
STELLAR_SECRET=S_YOUR_STELLAR_SECRET_KEY_HERE
SERVER_URL=http://localhost:3000
```

**`examples/.env.channel-server.example`**
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

**`examples/.env.channel-client.example`**
```env
# Channel Client Configuration
COMMITMENT_SECRET=your_64_hex_char_ed25519_secret_key_here
SERVER_URL=http://localhost:3001
SOURCE_ACCOUNT=G_YOUR_SOURCE_ACCOUNT_HERE
```

Also: remove the existing `.env` file with testnet keys from the repo if tracked.

---

### Step 7: CI/CD (GitHub Actions)

**`.github/workflows/ci.yml`:**

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
```

**Job: `check-test-build`:**
1. `actions/setup-node` (pinned SHA), Node 22
2. `corepack enable && corepack install` — reads `packageManager` from `package.json` -> `pnpm@10.33.0`
3. `pnpm install --frozen-lockfile`
4. `pnpm format:check`
5. `pnpm lint`
6. `pnpm check:types`
7. `pnpm test -- --run`
8. `pnpm build`

**Completion sentinel job:** `complete` that `needs: [check-test-build]` — single required status check for branch protection.

---

### Step 8: README.md + CLAUDE.md Updates

**README.md:**
- Add Prerequisites section (Node.js 22+, pnpm 10.33+, `corepack enable`)
- Update Install section
- Add Development section pointing to Makefile (`make help`, `make check`)
- Update Project structure tree (new files: `eslint.config.mjs`, `.prettierrc`, `Makefile`, `.github/`, `examples/config/`, `sdk/src/env.ts`)
- Update Server options docs to mention Express + security middleware
- Add Environment variables section referencing `.env.example` files
- Update export table to include `stellar-mpp-sdk/env`

**CLAUDE.md:**
- Add `make check`, `make help`, `pnpm lint`, `pnpm format:check` to Commands
- Add `sdk/src/env.ts` and `examples/config/` to Module Map
- Note Express migration in Key Patterns
- Add ESLint/Prettier to tooling notes

---

### Step 9: Review Gates

1. `/review` — code quality, consistency, adherence to plan
2. `/security-review` — security headers, env handling, dependency versions, CI config, exposed secrets
