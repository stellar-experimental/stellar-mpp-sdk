export const DEFAULT_MAX_FEE_BUMP_STROOPS = 10_000_000
export const DEFAULT_POLL_MAX_ATTEMPTS = 30
export const DEFAULT_POLL_DELAY_MS = 1_000
export const DEFAULT_POLL_BACKOFF_MULTIPLIER = 1.2
export const DEFAULT_POLL_JITTER_MS = 200
export const DEFAULT_POLL_TIMEOUT_MS = 30_000
export const DEFAULT_SIMULATION_TIMEOUT_MS = 10_000

/**
 * Default timeout in seconds for read-only contract getter simulations (State.ts).
 * This is distinct from DEFAULT_SIMULATION_TIMEOUT_MS which is the RPC call timeout
 * in milliseconds. This value is the Soroban transaction `setTimeout()` parameter.
 */
export const DEFAULT_SIM_TIMEOUT_SECS = 30
