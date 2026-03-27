import { charge as charge_ } from './Charge.js'

export function stellar(parameters: stellar.Parameters): ReturnType<typeof charge_> {
  return stellar.charge(parameters)
}

export namespace stellar {
  export type Parameters = charge_.Parameters
  export const charge = charge_
}
