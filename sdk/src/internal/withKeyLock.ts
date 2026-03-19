const lockTails = new Map<string, Promise<void>>()

export async function withKeyLock<result>(
  key: string,
  operation: () => Promise<result>,
): Promise<result> {
  const previousTail = lockTails.get(key) ?? Promise.resolve()

  let release!: () => void
  const currentTail = new Promise<void>((resolve) => {
    release = resolve
  })
  const queuedTail = previousTail.then(() => currentTail)

  lockTails.set(key, queuedTail)
  await previousTail

  try {
    return await operation()
  } finally {
    release()
    if (lockTails.get(key) === queuedTail) {
      lockTails.delete(key)
    }
  }
}