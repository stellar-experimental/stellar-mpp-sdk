#!/usr/bin/env bash
#
# Stellar MPP Demo — run server + client end-to-end
#
# Usage:
#   ./demo/run.sh                    # uses defaults (prompts if no keys set)
#   STELLAR_RECIPIENT=G... STELLAR_SECRET=S... ./demo/run.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Check prerequisites ──────────────────────────────────────────────────────
if ! command -v npx &>/dev/null; then
  echo "❌ npx not found. Install Node.js 20+ first."
  exit 1
fi

# ── Prompt for keys if not set ────────────────────────────────────────────────
if [ -z "${STELLAR_RECIPIENT:-}" ]; then
  echo ""
  echo "Enter your Stellar public key (recipient, starts with G):"
  read -rp "  STELLAR_RECIPIENT=" recipient
  export STELLAR_RECIPIENT="${recipient}"
fi

if [ -z "${STELLAR_SECRET:-}" ]; then
  echo ""
  echo "Enter your Stellar secret key (payer, starts with S):"
  read -rsp "  STELLAR_SECRET=" secret
  echo ""
  export STELLAR_SECRET="${secret}"
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  Stellar MPP Demo"
echo "  Recipient: ${STELLAR_RECIPIENT:0:8}...${STELLAR_RECIPIENT: -4}"
echo "  Payer:     ${STELLAR_SECRET:0:4}****"
echo "══════════════════════════════════════════════════"
echo ""

# ── Start server in background ────────────────────────────────────────────────
export PORT=${PORT:-3000}

# Kill any existing process on the port
if lsof -ti:$PORT &>/dev/null; then
  echo "⚠ Port $PORT in use — freeing it..."
  lsof -ti:$PORT | xargs kill -9 2>/dev/null
  sleep 1
fi

echo "▶ Starting server..."
npx tsx examples/charge-server.ts &
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
echo "▶ Running client..."
echo ""

# ── Run client ────────────────────────────────────────────────────────────────
SERVER_URL="http://localhost:$PORT" npx tsx examples/charge-client.ts

echo ""
echo "══════════════════════════════════════════════════"
echo "  Demo complete!"
echo "  UI also available at: http://localhost:$PORT/demo"
echo "══════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop the server."
wait $SERVER_PID
