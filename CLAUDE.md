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
pnpm test -- sdk/src/client/Charge.test.ts   # Run a single test file
```

## Architecture

### Twin Client/Server Pattern

Each payment mode mirrors a client and server implementation sharing a common method schema:

```
Methods.ts (Zod schema) → client/ (create credentials) + server/ (verify credentials)
```

### Module Map

| Path | Role |
|------|------|
| `sdk/src/Methods.ts` | Charge method schema (Zod discriminated union: `xdr` vs `signature` credentials) |
| `sdk/src/constants.ts` | SAC addresses (USDC/XLM), RPC URLs, network passphrases, defaults |
| `sdk/src/scval.ts` | Soroban ScVal ↔ BigInt conversion |
| `sdk/src/client/Charge.ts` | Creates SAC `transfer` invocations; handles pull (send XDR) and push (broadcast + send hash) flows |
| `sdk/src/server/Charge.ts` | Verifies and broadcasts SAC transfers; supports fee sponsorship via FeeBumpTransaction |
| `sdk/src/channel/Methods.ts` | Channel method schema (discriminated union: `open` / `voucher` / `close` actions) |
| `sdk/src/channel/client/Channel.ts` | Signs cumulative commitment amounts off-chain via ed25519; handles `open` action (sends signed deploy tx XDR + initial commitment) |
| `sdk/src/channel/server/Channel.ts` | Verifies commitment signatures via contract simulation; `open` action broadcasts the deploy tx and initialises cumulative store |
| `sdk/src/channel/server/State.ts` | Queries on-chain channel state (balance, close status, refund period) |
| `sdk/src/channel/server/Watcher.ts` | Polls for contract events (close, refund, top_up) |

### Subpath Exports

Package.json exports allow selective imports to avoid bundling unused code:
- `stellar-mpp-sdk` — root (schemas + constants)
- `stellar-mpp-sdk/client` — charge client only
- `stellar-mpp-sdk/server` — charge server only
- `stellar-mpp-sdk/channel` — channel schema
- `stellar-mpp-sdk/channel/client` — channel client
- `stellar-mpp-sdk/channel/server` — channel server

### Key Patterns

- **mppx integration**: Methods defined via `Method.from()`, adapted with `.toClient()` / `.toServer()`. Namespaced as `stellar.charge()` and `stellar.channel()`.
- **Serialization locks**: Both Charge and Channel servers use Promise-based locks (`let verifyLock: Promise<unknown> = Promise.resolve()`) to serialize verification and prevent race conditions on store get/put.
- **Contract simulation**: Uses Soroban RPC `simulateTransaction` for read-only verification — SAC transfer validation, `prepare_commitment` for commitment bytes, and channel state queries.
- **Zod validation**: All method schemas use Zod v4 with discriminated unions for credential/action types.

### Test Setup

- **Vitest** with test files colocated alongside source (`*.test.ts` next to `*.ts`)
- Tests mock `@stellar/stellar-sdk` and `mppx` internals
- Integration test at `sdk/src/channel/integration.test.ts`
