import { parseOptional, parseStellarSecretKey } from '../../sdk/src/env.js'

export class Env {
  static get stellarSecret(): string {
    return parseStellarSecretKey('STELLAR_SECRET')
  }

  static get serverUrl(): string {
    return parseOptional('SERVER_URL', 'http://localhost:3000')!
  }
}
