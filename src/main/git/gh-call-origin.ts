import { AsyncLocalStorage } from 'node:async_hooks'

// Why: the spend ledger names command shapes, but a budget fix needs to know which poller sent them (ORCA-1213).
const origin = new AsyncLocalStorage<string>()

/** Runs `fn` with every gh call inside it counted against `poller` in the spend ledger. */
export function runWithGhCallOrigin<T>(poller: string, fn: () => T): T {
  return origin.run(poller, fn)
}

export const currentGhCallOrigin = (): string => origin.getStore() ?? 'untagged'
