import { parseOptional, parseStellarSecretKey } from '../../sdk/src/env.js'

export class Env {
  static get stellarSecret(): string {
    return parseStellarSecretKey('STELLAR_SECRET')
  }

  static get serverUrl(): string {
    return parseOptional('SERVER_URL', 'http://localhost:3000')!
  }

  static get chargeClientMode(): 'push' | 'pull' {
    const mode = parseOptional('CHARGE_CLIENT_MODE', 'pull')!
    if (mode !== 'push' && mode !== 'pull') {
      throw new Error(`CHARGE_CLIENT_MODE must be 'push' or 'pull', got: ${mode}`)
    }
    return mode as 'push' | 'pull'
  }
}
