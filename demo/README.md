# Stellar MPP Demo

Interactive playground for testing the Stellar MPP payment flow — via browser UI or CLI.

Two demo modes are available:

- **Charge** — one-time on-chain SAC token transfers (default)
- **Channel** — off-chain payment channel commitments (no on-chain tx per payment)

## Prerequisites

- Node.js 20+
- A funded Stellar **testnet** account (create one at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test))
- `pnpm install` (from project root)
- For the **channel demo**: a deployed [one-way-channel](https://github.com/stellar-experimental/one-way-channel) contract on testnet

---

## Charge Demo (one-time transfers)

## Option 1: All-in-one script

The easiest way — prompts for keys if not set:

```bash
./demo/run.sh
```

Or pass keys directly:

```bash
STELLAR_RECIPIENT=GYOUR_PUBLIC_KEY STELLAR_SECRET=SYOUR_SECRET_KEY ./demo/run.sh
```

This starts the server, runs the client end-to-end, then keeps the server alive with the demo UI at `http://localhost:3000/demo`.

## Option 2: Two terminals

```bash
# Terminal 1 — start server
STELLAR_RECIPIENT=GYOUR_PUBLIC_KEY npx tsx examples/charge-server.ts
```

```bash
# Terminal 2 — run client
STELLAR_SECRET=SYOUR_SECRET_KEY npx tsx examples/charge-client.ts
```

Or use npm scripts:

```bash
# Terminal 1
STELLAR_RECIPIENT=G... pnpm demo:charge-server

# Terminal 2
STELLAR_SECRET=S... pnpm demo:charge-client
```

## Option 3: Browser UI

The server serves an interactive demo at `http://localhost:3000/demo`.

1. Start the server (Terminal 1 above)
2. Open `http://localhost:3000/demo` in your browser
3. **Step 1: Get Payment Challenge** — fetches the 402 challenge and displays the parsed request (amount, currency, recipient, network, reference)
4. **Step 2: Sign & Pay** — enter your Stellar secret key, select mode (pull/push), and click to sign & submit the payment end-to-end
5. On success, you'll see progress events (challenge → signing → signed → paid) and the server response

The UI also has a **CLI Scripts** tab with copy-paste terminal commands.

## How the flow works

```
Client                          Server
  |                               |
  |  GET /resource                |
  |------------------------------>|
  |                               |
  |  402 Payment Required         |
  |  WWW-Authenticate: Payment    |
  |  (challenge with amount,      |
  |   currency, recipient)        |
  |<------------------------------|
  |                               |
  |  Sign Soroban SAC transfer    |
  |  Send credential (XDR/hash)   |
  |------------------------------>|
  |                               |
  |  Verify on-chain              |
  |  200 OK + Receipt             |
  |<------------------------------|
```

## Environment variables

| Variable            | Required      | Description                                                       |
| ------------------- | ------------- | ----------------------------------------------------------------- |
| `STELLAR_RECIPIENT` | Charge server | Your Stellar public key (G..., 56 chars)                          |
| `STELLAR_SECRET`    | Charge client | Your Stellar secret key (S...)                                    |
| `MPP_SECRET_KEY`    | No            | MPP signing key (defaults to `stellar-mpp-demo-secret`)           |
| `PORT`              | No            | Server port (defaults to `3000` for charge, `3001` for channel)   |
| `SERVER_URL`        | No            | Client target URL (defaults to `http://localhost:3000` or `3001`) |

---

## Channel Demo (off-chain commitments)

Uses a [one-way payment channel](https://github.com/stellar-experimental/one-way-channel) contract for off-chain micro-payments. The funder signs cumulative ed25519 commitments — **no on-chain transaction per payment**.

### Prerequisites

You need a deployed channel contract. See the main [README](../README.md#one-way-payment-channels) for deployment instructions, or use these pre-deployed testnet values:

| Item                  | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Channel contract      | `CBU3P5BAU6CYGPAVY7TGGGNEPCS7H73IA3L677Z3CFZSGFYB7UFK4IMS`         |
| Commitment public key | `b83ee77019d9ca0aac432139fe0159ec01b5d31f58905fdc089980be05b7c5fd` |
| Commitment secret key | `73b51cad30e14119e78d9a3d5d143a55c07f57c53fe9b95aa6bb061d0d4afb4f` |

### Option 1: All-in-one script

```bash
./demo/run-channel.sh
```

Or pass keys directly:

```bash
CHANNEL_CONTRACT=CBU3P5BAU6CYGPAVY7TGGGNEPCS7H73IA3L677Z3CFZSGFYB7UFK4IMS \
COMMITMENT_PUBKEY=b83ee77019d9ca0aac432139fe0159ec01b5d31f58905fdc089980be05b7c5fd \
COMMITMENT_SECRET=73b51cad30e14119e78d9a3d5d143a55c07f57c53fe9b95aa6bb061d0d4afb4f \
./demo/run-channel.sh
```

### Option 2: Two terminals

```bash
# Terminal 1 — start channel server
CHANNEL_CONTRACT=CBU3P5BAU6CYGPAVY7TGGGNEPCS7H73IA3L677Z3CFZSGFYB7UFK4IMS \
COMMITMENT_PUBKEY=b83ee77019d9ca0aac432139fe0159ec01b5d31f58905fdc089980be05b7c5fd \
npx tsx examples/channel-server.ts
```

```bash
# Terminal 2 — run channel client
COMMITMENT_SECRET=73b51cad30e14119e78d9a3d5d143a55c07f57c53fe9b95aa6bb061d0d4afb4f \
npx tsx examples/channel-client.ts
```

Or use npm scripts:

```bash
# Terminal 1
CHANNEL_CONTRACT=C... COMMITMENT_PUBKEY=... pnpm demo:channel-server

# Terminal 2
COMMITMENT_SECRET=... pnpm demo:channel-client
```

### How the channel flow works

```
Client (Funder)                 Server (Recipient)
  |                               |
  |  GET /resource                |
  |------------------------------>|
  |                               |
  |  402 Payment Required         |
  |  (challenge: 0.1 XLM via     |
  |   channel, cumulative: 0)     |
  |<------------------------------|
  |                               |
  |  Sign commitment (cum: 1M)    |
  |  Send signature + amount      |
  |------------------------------>|
  |                               |
  |  Verify ed25519 signature     |
  |  200 OK + content             |
  |<------------------------------|
  |                               |
  |  GET /resource (again)        |
  |------------------------------>|
  |                               |
  |  402 (cumulative: 1000000)    |
  |<------------------------------|
  |                               |
  |  Sign commitment (cum: 2M)    |
  |------------------------------>|
  |                               |
  |  Verify, 200 OK               |
  |<------------------------------|
```

No on-chain transactions happen during payments. The server can close the channel and settle accumulated funds on-chain at any time.

### Channel environment variables

| Variable            | Required | Description                                                     |
| ------------------- | -------- | --------------------------------------------------------------- |
| `CHANNEL_CONTRACT`  | Server   | Deployed channel contract address (C..., 56 chars)              |
| `COMMITMENT_PUBKEY` | Server   | Ed25519 commitment public key (64 hex chars)                    |
| `COMMITMENT_SECRET` | Client   | Ed25519 commitment secret key (64 hex chars)                    |
| `MPP_SECRET_KEY`    | No       | MPP signing key (defaults to `stellar-mpp-channel-demo-secret`) |
| `PORT`              | No       | Server port (defaults to `3001`)                                |
| `SERVER_URL`        | No       | Client target URL (defaults to `http://localhost:3001`)         |

---

## Channel E2E Demo (full lifecycle with on-chain settlement)

Runs the **complete channel lifecycle** from scratch: create accounts → deploy contract → off-chain payments → on-chain close. All transactions are reported with Stellar Expert links for verification.

See [channel-e2e-output.txt](channel-e2e-output.txt) for example output from a real testnet run.

### Prerequisites

- Everything from the channel demo above, plus:
- [stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) installed
- The one-way-channel contract WASM file (build from the [one-way-channel repo](https://github.com/stellar-experimental/one-way-channel))

### Build the WASM

```bash
git clone https://github.com/stellar-experimental/one-way-channel
cd one-way-channel
stellar contract build
# WASM is at: target/wasm32v1-none/release/channel.wasm
```

### Run the demo

```bash
WASM_PATH=path/to/channel.wasm ./demo/run-channel-e2e.sh
```

The script will:

1. Create fresh funded testnet accounts (funder + recipient)
2. Generate a random ed25519 commitment keypair
3. Upload WASM and deploy the channel contract (on-chain)
4. Run 2 off-chain MPP payments via the SDK (no on-chain tx)
5. Close the channel on-chain — settling funds to recipient, refunding remainder to funder
6. Print all Stellar Expert links for transaction verification

### What happens on-chain

| Step            | Transaction               | On-chain? |
| --------------- | ------------------------- | --------- |
| Create accounts | Friendbot funding         | Yes       |
| Upload WASM     | `uploadWasm`              | Yes       |
| Deploy contract | `__constructor` + deposit | Yes       |
| Payment 1       | Commitment signature only | **No**    |
| Payment 2       | Commitment signature only | **No**    |
| Close channel   | `close(amount, sig)`      | Yes       |

### E2E environment variables

| Variable    | Required | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `WASM_PATH` | Yes      | Path to the compiled `channel.wasm` file |
| `PORT`      | No       | Server port (defaults to `3002`)         |
