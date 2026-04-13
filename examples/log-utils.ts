function isControlChar(c: number): boolean {
  return c <= 0x1f || c === 0x7f
}

/** Sanitise and truncate a value for safe log output. */
export function truncate(value: string, opts?: { head?: number; tail?: number }): string {
  let safe = ''
  for (let i = 0; i < value.length; i++) {
    if (!isControlChar(value.charCodeAt(i))) safe += value[i]
  }
  const head = opts?.head ?? 4
  const tail = opts?.tail ?? 4
  if (safe.length <= head + tail + 3) return safe
  return `${safe.slice(0, head)}...${safe.slice(-tail)}`
}
