# Stellar MPP Demo

Interactive playground for testing the Stellar MPP payment flow — via browser UI or CLI.

## Prerequisites

- Node.js 18+
- A funded Stellar **testnet** account (create one at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test))
- `pnpm install` (from project root)

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
STELLAR_RECIPIENT=GYOUR_PUBLIC_KEY npx tsx examples/server.ts
```

```bash
# Terminal 2 — run client
STELLAR_SECRET=SYOUR_SECRET_KEY npx tsx examples/client.ts
```

Or use npm scripts:

```bash
# Terminal 1
STELLAR_RECIPIENT=G... pnpm demo:server

# Terminal 2
STELLAR_SECRET=S... pnpm demo:client
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

| Variable | Required | Description |
|----------|----------|-------------|
| `STELLAR_RECIPIENT` | Server | Your Stellar public key (G..., 56 chars) |
| `STELLAR_SECRET` | Client | Your Stellar secret key (S...) |
| `MPP_SECRET_KEY` | No | MPP signing key (defaults to `stellar-mpp-demo-secret`) |
| `PORT` | No | Server port (defaults to `3000`) |
| `SERVER_URL` | No | Client target URL (defaults to `http://localhost:3000`) |
