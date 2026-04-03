import {
  parseContractAddress,
  parseHexKey,
  parseNumber,
  parseOptional,
  parsePort,
} from '../../sdk/src/env.js'

export class Env {
  static get port(): number {
    return parsePort('PORT', 3001)
  }

  static get channelContract(): string {
    return parseContractAddress('CHANNEL_CONTRACT')
  }

  static get commitmentPubkey(): string {
    return parseHexKey('COMMITMENT_PUBKEY')
  }

  static get mppSecretKey(): string {
    return parseOptional('MPP_SECRET_KEY', 'stellar-mpp-channel-demo-secret')!
  }

  static get rateLimitWindowMs(): number {
    return parseNumber('RATE_LIMIT_WINDOW_MS', { fallback: 60000, min: 1 })
  }

  static get rateLimitMax(): number {
    return parseNumber('RATE_LIMIT_MAX', { fallback: 100, min: 1 })
  }

  static get trustProxy(): string {
    return parseOptional('TRUST_PROXY', 'loopback,linklocal,uniquelocal')!
  }

  static get logLevel(): string {
    return parseOptional('LOG_LEVEL', 'info')!
  }
}
