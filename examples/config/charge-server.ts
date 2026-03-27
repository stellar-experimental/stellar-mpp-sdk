import {
  parseCommaSeparatedList,
  parseNumber,
  parseOptional,
  parsePort,
  parseStellarPublicKey,
} from '../../sdk/src/env.js'

export class Env {
  static get port(): number {
    return parsePort('PORT', 3000)
  }

  static get stellarRecipient(): string {
    return parseStellarPublicKey('STELLAR_RECIPIENT')
  }

  static get mppSecretKey(): string {
    return parseOptional('MPP_SECRET_KEY', 'stellar-mpp-demo-secret')!
  }

  static get corsOrigin(): string | string[] {
    const raw = parseOptional('CORS_ORIGIN', '*')!
    return raw === '*' ? '*' : parseCommaSeparatedList(raw)
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
}
