import { describe, expect, it } from 'vitest'
import type { CodexAppServerHostKey } from './codex-app-server-capability-cache'
import {
  driveCodexAppServerSessionSteps,
  driveCodexAppServerSessionStepsSync,
  isCodexAppServerSessionBusyError,
  runCodexAppServerSessionStep,
  type CodexAppServerSessionSteps
} from './codex-app-server-session-steps'

function* oneSession(
  hostKey: CodexAppServerHostKey,
  run: () => Promise<string>,
  runSync: () => string
): CodexAppServerSessionSteps<string> {
  try {
    return `ok:${yield* runCodexAppServerSessionStep({ hostKey, run, runSync })}`
  } catch (error) {
    return isCodexAppServerSessionBusyError(error) ? 'busy' : `error:${(error as Error).message}`
  }
}

describe('codex app-server session step drivers', () => {
  it('feeds each driver its own session result', async () => {
    const steps = () =>
      oneSession(
        'native',
        async () => 'async',
        () => 'sync'
      )
    expect(driveCodexAppServerSessionStepsSync(steps())).toBe('ok:sync')
    await expect(driveCodexAppServerSessionSteps(steps())).resolves.toBe('ok:async')
  })

  it('throws a failed session back into the transaction', async () => {
    const failing = () =>
      oneSession(
        'native',
        () => Promise.reject(new Error('timed out')),
        () => {
          throw new Error('timed out')
        }
      )
    expect(driveCodexAppServerSessionStepsSync(failing())).toBe('error:timed out')
    await expect(driveCodexAppServerSessionSteps(failing())).resolves.toBe('error:timed out')
  })

  it('refuses a blocking session on a host only while an async one is in flight there', async () => {
    let release!: (value: string) => void
    const inFlight = driveCodexAppServerSessionSteps(
      oneSession(
        'native',
        () => new Promise<string>((resolve) => (release = resolve)),
        () => 'unused'
      )
    )
    let blockingRan = false
    const blocking = (hostKey: CodexAppServerHostKey) =>
      oneSession(
        hostKey,
        async () => 'unused',
        () => {
          blockingRan = true
          return 'sync'
        }
      )

    expect(driveCodexAppServerSessionStepsSync(blocking('native'))).toBe('busy')
    expect(blockingRan).toBe(false)
    expect(driveCodexAppServerSessionStepsSync(blocking('wsl:Ubuntu'))).toBe('ok:sync')

    release('async')
    await expect(inFlight).resolves.toBe('ok:async')
    expect(driveCodexAppServerSessionStepsSync(blocking('native'))).toBe('ok:sync')
  })
})
