export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}
