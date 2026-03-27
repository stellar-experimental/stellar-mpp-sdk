# E2E Check

Run the full end-to-end verification suite to ensure the solution is working correctly. This includes the quality pipeline, example script validation, and live testnet demos.

## Prerequisites

- A `.env` file at the project root with testnet keys (see `examples/.env.*.example` for reference)
- Funded Stellar testnet accounts
- `pnpm` installed

## Checks

Run all checks in order. Stop on first failure and report.

### 1. Full Quality Pipeline (`make check`)

Run the full quality pipeline which mirrors CI:

```bash
make check
```

This runs: install -> format-check -> lint -> typecheck -> test -> build.

**Expected:** All pass. 0 lint errors (warnings OK). All tests pass. Build succeeds.

### 2. Example Script Validation

Verify all 6 example scripts start correctly (imports resolve, env parsing works):

```bash
for f in examples/server.ts examples/client.ts examples/channel-server.ts examples/channel-client.ts examples/channel-open.ts examples/channel-close.ts; do
  echo "--- $f ---"
  timeout 3 npx tsx "$f" 2>&1 | head -3
  echo ""
done
```

**Expected:**
- `examples/server.ts` — Starts Express server on port 3000 (pino JSON log)
- `examples/client.ts` — Loads keypair, starts client
- `examples/channel-server.ts` — Starts Express channel server on port 3001 (pino JSON log)
- `examples/channel-client.ts` — Loads commitment key, starts client
- `examples/channel-open.ts` — Fails at env validation (`OPEN_TX_XDR is required`) — expected, env var not set
- `examples/channel-close.ts` — Fails at env validation (`CHANNEL_CONTRACT is required` or similar) — expected when no `.env` loaded

No import errors or syntax errors should appear. Runtime env validation errors are expected for scripts that require additional env vars beyond `.env`.

### 3. Charge E2E Demo (`demo/run.sh`)

Run the charge payment flow end-to-end against Stellar testnet:

```bash
source .env
STELLAR_RECIPIENT="$STELLAR_RECIPIENT" STELLAR_SECRET="$STELLAR_SECRET" timeout 120 ./demo/run.sh
```

**Expected flow:**
1. Server starts on port 3000 with pino JSON logging
2. Client receives 402 Payment Required challenge
3. Client signs SAC transfer transaction
4. Server verifies and broadcasts on Stellar testnet
5. **200 OK** response with "Payment verified" message

**Success criteria:** The client prints a `--- Response (200) ---` with the paid content JSON.

### 4. Channel E2E Demo (`demo/run-channel.sh`)

Run the off-chain channel payment flow:

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

**Success criteria:** Both requests return 200. Cumulative amount grows between requests.

### 5. Channel E2E with On-Chain Settlement (`demo/run-channel-e2e.sh`)

> **TODO:** This check requires a compiled one-way-channel WASM file from https://github.com/stellar-experimental/one-way-channel. It runs the full lifecycle: deploy -> off-chain payments -> on-chain close.
>
> ```bash
> WASM_PATH=path/to/channel.wasm ./demo/run-channel-e2e.sh
> ```
>
> Not automated yet — requires external dependency setup.

## Reporting

After running all checks, report results in this format:

| Check | Status | Notes |
|-------|--------|-------|
| `make check` (full pipeline) | PASS/FAIL | test count, any errors |
| Example script validation (6 scripts) | PASS/FAIL | which scripts failed |
| Charge E2E (`demo/run.sh`) | PASS/FAIL | final HTTP status |
| Channel E2E (`demo/run-channel.sh`) | PASS/FAIL | request count, cumulative amounts |
| Channel E2E settlement (`demo/run-channel-e2e.sh`) | TODO | requires WASM file |
