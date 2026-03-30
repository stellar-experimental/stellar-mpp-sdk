---
name: e2e-check
description: Use when verifying the full solution works end-to-end — after refactoring, before PRs, or after dependency upgrades. Runs quality pipeline, validates example scripts, and executes live Stellar testnet demos for both charge and channel payment modes.
---

# E2E Check

Full end-to-end verification: quality pipeline, example script validation, and live Stellar testnet demos.

**Prerequisites:** `.env` file at project root with testnet keys (see `examples/.env.*.example`), funded Stellar testnet accounts, `pnpm` installed.

Run all checks in order. Stop on first failure and report.

## Check 1: Full Quality Pipeline

```bash
make check
```

Runs: install -> format-check -> lint -> typecheck -> test -> build.

**Pass:** 0 lint errors (warnings OK), all tests pass, build succeeds.

## Check 2: Example Script Validation

Verify all 6 example scripts start correctly (imports resolve, env parsing works):

```bash
for f in examples/charge-server.ts examples/charge-client.ts examples/channel-server.ts examples/channel-client.ts examples/channel-open.ts examples/channel-close.ts; do
  echo "--- $f ---"
  timeout 3 npx tsx "$f" 2>&1 | head -3
  echo ""
done
```

**Pass criteria per script:**

| Script                       | Expected                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `examples/charge-server.ts`         | Starts Express on port 3000 (pino JSON log)                     |
| `examples/charge-client.ts`         | Loads keypair, starts client                                    |
| `examples/channel-server.ts` | Starts Express on port 3001 (pino JSON log)                     |
| `examples/channel-client.ts` | Loads commitment key, starts client                             |
| `examples/channel-open.ts`   | Env validation error: `OPEN_TX_XDR is required` (expected)      |
| `examples/channel-close.ts`  | Env validation error: `CHANNEL_CONTRACT is required` (expected) |

**Fail:** Any import error, syntax error, or module-not-found error.

## Check 3: Charge E2E Demo

```bash
source .env
STELLAR_RECIPIENT="$STELLAR_RECIPIENT" STELLAR_SECRET="$STELLAR_SECRET" timeout 120 ./demo/run.sh
```

**Expected flow:**

1. Server starts on port 3000 with pino JSON logging
2. Client receives 402 Payment Required challenge
3. Client signs SAC transfer transaction
4. Server verifies and broadcasts on Stellar testnet
5. **200 OK** with "Payment verified" message

**Pass:** Client prints `--- Response (200) ---` with paid content JSON.

## Check 4: Channel E2E Demo

```bash
source .env
CHANNEL_CONTRACT="$CHANNEL_CONTRACT" COMMITMENT_PUBKEY="$COMMITMENT_PUBKEY" COMMITMENT_SECRET="$COMMITMENT_SECRET" SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-}" timeout 120 ./demo/run-channel.sh
```

**Expected flow:**

1. Channel server starts on port 3001 with pino JSON logging
2. Client makes 2 requests, signing cumulative commitments off-chain
3. Request 1: cumulative 1,000,000 stroops -> **200 OK**
4. Request 2: cumulative 2,000,000 stroops -> **200 OK**
5. "No on-chain transaction was needed for this payment!"

**Pass:** Both requests return 200. Cumulative amount grows between requests.

## Check 5: Channel E2E with On-Chain Settlement

Requires the compiled one-way-channel WASM from https://github.com/stellar-experimental/one-way-channel.

```bash
WASM_PATH=/Users/marcelosantos/Workspace/one-way-channel/target/wasm32v1-none/release/channel.wasm \
  ./demo/run-channel-e2e.sh
```

Full lifecycle: deploy contract -> 2 off-chain payments -> on-chain close -> balance verified at 0.

**Expected flow:**

1. Deploys one-way-channel contract on Stellar testnet
2. Funder opens channel with initial deposit
3. 2 off-chain payment commitments via MPP 402 flow
4. Recipient closes channel on-chain with latest commitment
5. Final balance verified at 0 (all funds claimed)

**Pass:** Script completes with `Channel balance after close: 0` and exit code 0.

## Check 6: CHANGELOG Entry

Every PR must add a line to `CHANGELOG.md` under the current unreleased version section. Each entry must link to its PR using the format:

```
- Description of the change [#PR_NUMBER](https://github.com/stellar/stellar-mpp-sdk/pull/PR_NUMBER)
```

**Pass:** The diff includes a CHANGELOG.md addition with a PR link in the correct format.

**Fail:** No CHANGELOG entry, or entry missing the `[#N](url)` PR link.

## Reporting

After running all checks, report:

| Check                                              | Status    | Notes                             |
| -------------------------------------------------- | --------- | --------------------------------- |
| `make check` (full pipeline)                       | PASS/FAIL | test count, any errors            |
| Example script validation (6 scripts)              | PASS/FAIL | which scripts failed              |
| Charge E2E (`demo/run.sh`)                         | PASS/FAIL | final HTTP status                 |
| Channel E2E (`demo/run-channel.sh`)                | PASS/FAIL | request count, cumulative amounts |
| Channel E2E settlement (`demo/run-channel-e2e.sh`) | PASS/FAIL | balance after close               |
