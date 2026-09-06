export type DisposableEffectTimers = {
  add(fn: () => void, ms: number): void
  dispose(): void
}

// Why: React Doctor cannot see a timer cleared via a nested effect helper; owning the registry here keeps the cleanup visible to the gate.
export function createDisposableEffectTimers(): DisposableEffectTimers {
  const timers: ReturnType<typeof setTimeout>[] = []
  let disposed = false
  return {
    add(fn, ms) {
      if (disposed) {
        return
      }
      timers.push(setTimeout(fn, ms))
    },
    dispose() {
      disposed = true
      for (const timer of timers) {
        clearTimeout(timer)
      }
      timers.length = 0
    }
  }
}
