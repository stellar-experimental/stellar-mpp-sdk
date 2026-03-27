# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stellar MPP SDK — a TypeScript SDK implementing Stellar blockchain payment methods for the Machine Payments Protocol (MPP). Provides two payment modes:

- **Charge**: One-time on-chain SAC (Stellar Asset Contract) token transfers with pull/push credential modes
- **Channel**: Off-chain payment commitments via one-way payment channel contracts (batch settlement on close)

Built on the `mppx` framework. Peer dependencies: `@stellar/stellar-sdk` (>=14.0.0) and `mppx` (>=0.4.0).

## Commands

```bash
pnpm install            # Install deps (also runs `tsc` via prepare script)
pnpm run build          # Compile TypeScript → dist/
pnpm run check:types    # Type-check only (tsc --noEmit)
pnpm test               # Run vitest (watch mode)
pnpm test -- --run      # Run tests once without watch
pnpm test -- sdk/src/charge/client/Charge.test.ts   # Run a single test file
make help               # Show all Makefile targets
make check              # Run full quality pipeline (mirrors CI)
pnpm run lint           # Run ESLint
pnpm run format:check   # Check Prettier formatting
```

## Verification Checklist

After any code change, run **all** of the following to ensure nothing is broken:

### 1. Offline checks (always run)

```bash
pnpm test -- --run       # 140 unit tests
pnpm run check:types     # TypeScript type check
pnpm run build           # Compile to dist/
```

### 2. Example scripts (always run)

Each example must load and execute without import/type errors. Expected behavior noted inline.

```bash
# Charge server — should start and return 402 on requests
PORT=3099 STELLAR_RECIPIENT=GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKUVJ3LKEWI4ZNVPP5EFC \
  npx tsx examples/server.ts
# → "Stellar MPP server running on http://localhost:3099" — Ctrl+C to stop

# Channel server — should start and return 402 on requests
CHANNEL_CONTRACT=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  COMMITMENT_PUBKEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  SOURCE_ACCOUNT=GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKUVJ3LKEWI4ZNVPP5EFC \
  PORT=3098 \
  npx tsx examples/channel-server.ts
# → "Stellar MPP Channel server running on http://localhost:3098" — Ctrl+C to stop

# Client — should load, create keypair, fail on network (no server running)
STELLAR_SECRET=$(npx tsx -e "import{Keypair}from'@stellar/stellar-sdk';console.log(Keypair.random().secret())" 2>/dev/null) \
  SERVER_URL=http://localhost:9999 \
  npx tsx examples/client.ts
# → "Using Stellar account: G..." then ECONNREFUSED (expected)

# Channel client — should load, create commitment key, fail on network
COMMITMENT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  SOURCE_ACCOUNT=GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKUVJ3LKEWI4ZNVPP5EFC \
  SERVER_URL=http://localhost:9999 \
  npx tsx examples/channel-client.ts
# → "Using commitment key: G..." then ECONNREFUSED (expected)

# Channel open — should exit with env var validation error
npx tsx examples/channel-open.ts
# → "Set OPEN_TX_XDR to..." (expected)

# Channel close — should exit with env var validation error
npx tsx examples/channel-close.ts
# → "Set CLOSE_SECRET to..." (expected)
```

### 3. E2E demo (run when channel logic changes)

Requires: `stellar` CLI, Node.js 20+, and the one-way-channel WASM binary.

```bash
WASM_PATH=/Users/marcelosantos/Workspace/one-way-channel/target/wasm32v1-none/release/channel.wasm \
  ./demo/run-channel-e2e.sh
# Full lifecycle: deploy → 2 off-chain payments → on-chain close → balance verified at 0
```

### 4. Interactive demos (run manually with funded testnet accounts)

```bash
./demo/run.sh              # Charge demo — prompts for STELLAR_RECIPIENT + STELLAR_SECRET
./demo/run-channel.sh      # Channel demo — prompts for CHANNEL_CONTRACT + COMMITMENT keys
```

## Architecture

### Twin Client/Server Pattern

Each payment mode mirrors a client and server implementation sharing a common method schema:

```
Methods.ts (Zod schema) → client/ (create credentials) + server/ (verify credentials)
```

### Module Map

| Path                                | Role                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sdk/src/charge/Methods.ts`         | Charge method schema (Zod discriminated union: `transaction` vs `hash` credentials)                                                |
| `sdk/src/charge/client/Charge.ts`   | Creates SAC `transfer` invocations; handles pull (send XDR) and push (broadcast + send hash) flows                                 |
| `sdk/src/charge/server/Charge.ts`   | Verifies and broadcasts SAC transfers; supports fee sponsorship via FeeBumpTransaction                                             |
| `sdk/src/channel/Methods.ts`        | Channel method schema (discriminated union: `open` / `voucher` / `close` actions)                                                  |
| `sdk/src/channel/client/Channel.ts` | Signs cumulative commitment amounts off-chain via ed25519; handles `open` action (sends signed deploy tx XDR + initial commitment) |
| `sdk/src/channel/server/Channel.ts` | Verifies commitment signatures via contract simulation; `open` action broadcasts the deploy tx and initialises cumulative store    |
| `sdk/src/channel/server/State.ts`   | Queries on-chain channel state (balance, close status, refund period)                                                              |
| `sdk/src/channel/server/Watcher.ts` | Polls for contract events (close, refund, top_up)                                                                                  |
| `sdk/src/shared/defaults.ts`        | Internal default constants (poll intervals, fee limits, timeouts)                                                                  |
| `sdk/src/shared/errors.ts`          | StellarMppError, PaymentVerificationError, ChannelVerificationError                                                                |
| `sdk/src/shared/fee-bump.ts`        | Fee bump wrapping                                                                                                                  |
| `sdk/src/shared/keypairs.ts`        | Keypair resolution (Keypair or S... string)                                                                                        |
| `sdk/src/shared/logger.ts`          | Logger interface (pino-compatible) and noopLogger                                                                                  |
| `sdk/src/shared/poll.ts`            | Transaction polling with backoff and jitter                                                                                        |
| `sdk/src/shared/scval.ts`           | Soroban ScVal ↔ BigInt conversion                                                                                                  |
| `sdk/src/shared/simulate.ts`        | Simulation with timeout and error classification                                                                                   |
| `sdk/src/shared/units.ts`           | toBaseUnits / fromBaseUnits                                                                                                        |
| `sdk/src/shared/validation.ts`      | Hex signature and amount validation                                                                                                |
| `sdk/src/constants.ts`              | SAC addresses (USDC/XLM), RPC URLs, network passphrases, defaults                                                                  |
| `sdk/src/env.ts`                    | Stellar-aware env parsing primitives (parsePort, parseStellarPublicKey, etc.)                                                      |
| `examples/config/*.ts`              | Per-example Env classes using env primitives                                                                                       |

### Subpath Exports

Package.json exports allow selective imports to avoid bundling unused code:

- `stellar-mpp-sdk` — root (schemas + constants + `resolveKeypair` + `Logger` type + unit conversion)
- `stellar-mpp-sdk/charge` — charge method schema
- `stellar-mpp-sdk/charge/client` — charge client only
- `stellar-mpp-sdk/charge/server` — charge server only
- `stellar-mpp-sdk/channel` — channel schema
- `stellar-mpp-sdk/channel/client` — channel client
- `stellar-mpp-sdk/channel/server` — channel server
- `stellar-mpp-sdk/env` — env parsing primitives

### Shared Utilities Convention

The `shared/` directory contains internal utility modules. These are **not** exported as a subpath from the package. Exceptions that are re-exported from the root `index.ts`:

- `resolveKeypair` (from `shared/keypairs.ts`)
- `Logger` type (from `shared/logger.ts`)
- `toBaseUnits` / `fromBaseUnits` (from `shared/units.ts`)

All other `shared/` modules are strictly internal and consumed only by `charge/` and `channel/` code.

### Key Patterns

- **mppx integration**: Methods defined via `Method.from()`, adapted with `.toClient()` / `.toServer()`. Namespaced as `stellar.charge()` and `stellar.channel()`.
- **Serialization locks**: Both Charge and Channel servers use Promise-based locks (`let verifyLock: Promise<unknown> = Promise.resolve()`) to serialize verification and prevent race conditions on store get/put.
- **Contract simulation**: Uses Soroban RPC `simulateTransaction` for read-only verification — SAC transfer validation, `prepare_commitment` for commitment bytes, and channel state queries.
- **Zod validation**: All method schemas use Zod v4 with discriminated unions for credential/action types.
- **Shared utility extraction**: Common logic (polling, fee bumps, simulation, keypair resolution, validation, error types, logging) lives in `shared/` and is imported by both `charge/` and `channel/`.
- **Configurable defaults**: Server and client functions accept optional parameters (`pollMaxAttempts`, `pollDelayMs`, `pollTimeoutMs`, `simulationTimeoutMs`, `maxFeeBumpStroops`, `logger`) with defaults from `shared/defaults.ts`, applied via parameter destructuring.
- **Logger interface**: Matches pino's API (`debug`, `info`, `warn`, `error` methods). A `noopLogger` is used when no logger is provided.
- **Store key naming**: Keys follow the convention `stellar:{intent}:{type}:{id}` (e.g., `stellar:charge:nonce:abc123`).
- **Express + security headers**: Example servers use Express with helmet, CORS, and rate limiting middleware. Env vars configure CORS origins, rate limits, and trust proxy.
- **Env parsing**: Published as `stellar-mpp-sdk/env`. Core primitives read from `process.env` with validation. Per-example `Env` classes compose these into static getters.

### Test Setup

- **Vitest** with test files colocated alongside source (`*.test.ts` next to `*.ts`)
- Tests mock `@stellar/stellar-sdk` and `mppx` internals
- Integration test at `sdk/src/channel/integration.test.ts`

### Tooling

- **ESLint 9** flat config (`eslint.config.mjs`) with typescript-eslint recommended rules
- **Prettier** for formatting (`.prettierrc`), separate from ESLint
- **GitHub Actions** CI runs: format-check → lint → typecheck → test → build
- **Makefile** for dev workflow (`make help` for all targets, `make check` mirrors CI)
