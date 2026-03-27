import { parseHexKey, parseOptional } from '../../sdk/src/env.js'

export class Env {
  static get commitmentSecret(): string {
    return parseHexKey('COMMITMENT_SECRET')
  }

  static get serverUrl(): string {
    return parseOptional('SERVER_URL', 'http://localhost:3001')!
  }

  static get sourceAccount(): string | undefined {
    return parseOptional('SOURCE_ACCOUNT')
  }
}
