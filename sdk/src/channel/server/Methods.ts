import { channel as channel_ } from './Channel.js'

export function stellar(
  parameters: stellar.Parameters,
): ReturnType<typeof channel_> {
  return stellar.channel(parameters)
}

export namespace stellar {
  export type Parameters = channel_.Parameters
  export const channel = channel_
}
