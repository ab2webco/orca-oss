import type { CodexAppServerHostKey } from './codex-app-server-capability-cache'

// Why: trust install is one transaction (write hooks, run codex app-server,
// verify or roll back) that launch prep needs blocking and startup needs
// async. Written once as a generator that yields each session; a driver
// decides whether the session blocks the main process or awaits it.

export type CodexAppServerSessionStep<R = unknown> = {
  hostKey: CodexAppServerHostKey
  runSync: () => R
  run: () => Promise<R>
}

export type CodexAppServerSessionSteps<T> = Generator<CodexAppServerSessionStep, T, unknown>

export class CodexAppServerSessionBusyError extends Error {
  constructor(hostKey: CodexAppServerHostKey) {
    super(`codex app-server session already in flight on ${hostKey}`)
    this.name = 'CodexAppServerSessionBusyError'
  }
}

export function isCodexAppServerSessionBusyError(
  error: unknown
): error is CodexAppServerSessionBusyError {
  return error instanceof CodexAppServerSessionBusyError
}

const asyncSessionsInFlight = new Map<CodexAppServerHostKey, number>()

export function* runCodexAppServerSessionStep<R>(
  step: CodexAppServerSessionStep<R>
): CodexAppServerSessionSteps<R> {
  return (yield step) as R
}

/**
 * Blocking driver. A host with an async session in flight refuses instead of
 * spawning: that session may be the one hanging, and blocking here would
 * freeze the window for its whole deadline.
 */
export function driveCodexAppServerSessionStepsSync<T>(steps: CodexAppServerSessionSteps<T>): T {
  let next = steps.next()
  while (!next.done) {
    let result: unknown
    try {
      if (asyncSessionsInFlight.has(next.value.hostKey)) {
        throw new CodexAppServerSessionBusyError(next.value.hostKey)
      }
      result = next.value.runSync()
    } catch (error) {
      next = steps.throw(error)
      continue
    }
    next = steps.next(result)
  }
  return next.value
}

export async function driveCodexAppServerSessionSteps<T>(
  steps: CodexAppServerSessionSteps<T>
): Promise<T> {
  let next = steps.next()
  while (!next.done) {
    const { hostKey } = next.value
    asyncSessionsInFlight.set(hostKey, (asyncSessionsInFlight.get(hostKey) ?? 0) + 1)
    let settled: { ok: true; value: unknown } | { ok: false; error: unknown }
    try {
      settled = { ok: true, value: await next.value.run() }
    } catch (error) {
      settled = { ok: false, error }
    } finally {
      const remaining = (asyncSessionsInFlight.get(hostKey) ?? 1) - 1
      if (remaining > 0) {
        asyncSessionsInFlight.set(hostKey, remaining)
      } else {
        asyncSessionsInFlight.delete(hostKey)
      }
    }
    next = settled.ok ? steps.next(settled.value) : steps.throw(settled.error)
  }
  return next.value
}
