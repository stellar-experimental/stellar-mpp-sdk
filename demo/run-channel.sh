#!/usr/bin/env bash
#
# Stellar MPP Channel Demo — run channel server + client end-to-end
#
# Uses the one-way payment channel for off-chain micro-payments.
# No on-chain transaction per payment — only commitment signatures.
#
# Usage:
#   ./demo/run-channel.sh                    # prompts for keys
#   CHANNEL_CONTRACT=C... COMMITMENT_PUBKEY=... COMMITMENT_SECRET=... ./demo/run-channel.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Check prerequisites ──────────────────────────────────────────────────────
if ! command -v npx &>/dev/null; then
  echo "❌ npx not found. Install Node.js 20+ first."
  exit 1
fi

# ── Prompt for keys if not set ────────────────────────────────────────────────
if [ -z "${CHANNEL_CONTRACT:-}" ]; then
  echo ""
  echo "Enter the channel contract address (starts with C, 56 chars):"
  read -rp "  CHANNEL_CONTRACT=" channel_contract
  export CHANNEL_CONTRACT="${channel_contract}"
fi

if [ -z "${COMMITMENT_PUBKEY:-}" ]; then
  echo ""
  echo "Enter the ed25519 commitment public key (64 hex chars):"
  read -rp "  COMMITMENT_PUBKEY=" commitment_pubkey
  export COMMITMENT_PUBKEY="${commitment_pubkey}"
fi

if [ -z "${COMMITMENT_SECRET:-}" ]; then
  echo ""
  echo "Enter the ed25519 commitment secret key (64 hex chars):"
  read -rsp "  COMMITMENT_SECRET=" commitment_secret
  echo ""
  export COMMITMENT_SECRET="${commitment_secret}"
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  Stellar MPP Channel Demo"
echo "  Contract: ${CHANNEL_CONTRACT:0:12}...${CHANNEL_CONTRACT: -4}"
echo "  Commit key: ${COMMITMENT_PUBKEY:0:16}..."
echo "══════════════════════════════════════════════════"
echo ""

# ── Start server in background ────────────────────────────────────────────────
PORT=${PORT:-3001}

# Kill any existing process on the port
if lsof -ti:$PORT &>/dev/null; then
  echo "⚠ Port $PORT in use — freeing it..."
  lsof -ti:$PORT | xargs kill -9 2>/dev/null
  sleep 1
fi

echo "▶ Starting channel server on port $PORT..."
PORT=$PORT npx tsx examples/channel-server.ts &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Wait for server to be ready
for i in $(seq 1 10); do
  if curl -s http://localhost:$PORT >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo ""
echo "▶ Running channel client (2 requests to show cumulative growth)..."
echo ""

# ── Run client ────────────────────────────────────────────────────────────────
SERVER_URL="http://localhost:$PORT" npx tsx examples/channel-client.ts

echo ""
echo "══════════════════════════════════════════════════"
echo "  Channel Demo complete!"
echo "  Two payments made via off-chain commitments."
echo "  No on-chain transactions were needed!"
echo "══════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop the server."
wait $SERVER_PID
