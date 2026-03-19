import { rpc, xdr } from '@stellar/stellar-sdk'
import {
  SOROBAN_RPC_URLS,
  type NetworkId,
} from '../../constants.js'

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ChannelEvent =
  | { type: 'close'; amount: bigint; txHash: string; ledger: number; ledgerClosedAt: string }
  | { type: 'close_start'; txHash: string; ledger: number; ledgerClosedAt: string }
  | { type: 'refund'; amount: bigint; txHash: string; ledger: number; ledgerClosedAt: string }
  | { type: 'top_up'; amount: bigint; txHash: string; ledger: number; ledgerClosedAt: string }

const KNOWN_TOPICS = new Set(['close', 'close_start', 'refund', 'top_up'])

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/**
 * Polls Soroban RPC for contract events on a one-way payment channel.
 *
 * @returns A stop function that cancels the polling loop.
 *
 * @example
 * ```ts
 * import { watchChannel } from 'stellar-mpp-sdk/channel/server'
 *
 * const stop = watchChannel({
 *   channel: 'CABC...',
 *   onEvent(event) {
 *     if (event.type === 'close_start') {
 *       console.log('Dispute opened — respond before timeout!')
 *     }
 *   },
 * })
 *
 * // Later, stop watching:
 * stop()
 * ```
 */
export function watchChannel(parameters: watchChannel.Parameters): () => void {
  const {
    channel,
    network = 'testnet',
    rpcUrl,
    intervalMs = 5_000,
    onEvent,
    onError,
    signal,
  } = parameters

  const resolvedRpcUrl = rpcUrl ?? SOROBAN_RPC_URLS[network]
  const server = new rpc.Server(resolvedRpcUrl)

  let cursor: string | undefined
  let startLedger: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  async function init() {
    if (startLedger != null) return
    const latest = await server.getLatestLedger()
    startLedger = latest.sequence
  }

  async function poll() {
    if (stopped) return

    try {
      await init()

      const request: rpc.Api.GetEventsRequest = cursor
        ? {
            filters: [{
              type: 'contract' as const,
              contractIds: [channel],
              topics: [['*']],
            }],
            cursor,
          }
        : {
            filters: [{
              type: 'contract' as const,
              contractIds: [channel],
              topics: [['*']],
            }],
            startLedger: startLedger!,
          }

      const response = await server.getEvents(request)

      for (const event of response.events) {
        const parsed = parseEvent(event)
        if (parsed) {
          onEvent(parsed)
        }
      }

      if (response.events.length > 0) {
        cursor = response.cursor
      }
    } catch (error) {
      if (!stopped) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  function stop() {
    stopped = true
    if (timer != null) {
      clearInterval(timer)
      timer = undefined
    }
  }

  if (signal) {
    if (signal.aborted) {
      stopped = true
      return stop
    }
    signal.addEventListener('abort', stop, { once: true })
  }

  // Start polling immediately, then on interval
  void poll()
  timer = setInterval(() => void poll(), intervalMs)

  return stop
}

export declare namespace watchChannel {
  interface Parameters {
    /** Channel contract address (C...). */
    channel: string
    /** Network identifier. Defaults to 'testnet'. */
    network?: NetworkId
    /** Custom Soroban RPC URL. */
    rpcUrl?: string
    /** Polling interval in milliseconds. Defaults to 5000. */
    intervalMs?: number
    /** Called for each channel event. */
    onEvent: (event: ChannelEvent) => void
    /** Called when a polling error occurs. */
    onError?: (error: Error) => void
    /** AbortSignal for clean shutdown. */
    signal?: AbortSignal
  }
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

function parseEvent(event: rpc.Api.EventResponse): ChannelEvent | null {
  if (!event.topic || event.topic.length === 0) return null

  const topicName = decodeSymbol(event.topic[0])
  if (!topicName || !KNOWN_TOPICS.has(topicName)) return null

  const { txHash, ledger, ledgerClosedAt } = event

  switch (topicName) {
    case 'close':
      return { type: 'close', amount: decodeI128(event.value), txHash, ledger, ledgerClosedAt }
    case 'close_start':
      return { type: 'close_start', txHash, ledger, ledgerClosedAt }
    case 'refund':
      return { type: 'refund', amount: decodeI128(event.value), txHash, ledger, ledgerClosedAt }
    case 'top_up':
      return { type: 'top_up', amount: decodeI128(event.value), txHash, ledger, ledgerClosedAt }
    default:
      return null
  }
}

function decodeSymbol(scVal: xdr.ScVal): string | null {
  try {
    if (scVal.switch().value === xdr.ScValType.scvSymbol().value) {
      return scVal.sym().toString()
    }
  } catch {
    // Not a symbol
  }
  return null
}

function decodeI128(scVal: xdr.ScVal): bigint {
  try {
    const i128 = scVal.i128()
    const hi = BigInt(i128.hi().toString())
    const lo = BigInt(i128.lo().toString())
    return (hi << 64n) | lo
  } catch {
    return 0n
  }
}
