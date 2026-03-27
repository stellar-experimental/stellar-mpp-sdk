export class StellarMppError extends Error {
  public readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = this.constructor.name
    this.details = details
  }
}

export class PaymentVerificationError extends StellarMppError {}

export class ChannelVerificationError extends StellarMppError {}
