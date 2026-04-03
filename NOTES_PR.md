# Draft Pull Request

**Base branch:** main

## Title
fix: harden verification, replay protection, and sponsored charge path

## What
- Prevent challenge/hash replay via synchronous claim before async verification (TOCTOU fix)
- Fix sponsored charge path submitting transactions with wrong sequence number (txBadSeq)
- Default `checkOnChainState` to `true` in channel server
- Extract shared helpers (`claim.ts`, `verify-invoke.ts`, `validation.ts`, `log-utils.ts`)
- Harden env parsing with full Stellar strkey checksum validation
- Add charge-client-fee-bump example for flows 2 and 4
- Add `CHARGE_CLIENT_MODE` env var for push/pull mode selection
- Expand test coverage from ~175 to 370 tests

## Why
Addresses replay protection gaps in multi-instance deployments, a broken sponsored charge path (every sponsored transaction failed with `txBadSeq`), and missing validation across the codebase.

Closes https://github.com/stellar/internal-agents/issues/323
Closes https://github.com/stellar/internal-agents/issues/322
Closes https://github.com/stellar/internal-agents/issues/318
