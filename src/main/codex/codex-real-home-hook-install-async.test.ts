import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCodexHookTrustGrantSession } from './codex-app-server-client'

const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn<() => string>() }))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: homedirMock }
})

import {
  ensureRealHomeCodexHookState,
  ensureRealHomeCodexHookStateAsync,
  isRealHomeCodexHookLaneUsable,
  _internals
} from './codex-real-home-hook-install'
import { grantManagedCodexHookTrust, _internals as grantInternals } from './codex-hook-trust-grant'

// A `codex app-server` that starts, records its pid, and never answers an RPC.
const SILENT_CODEX_SCRIPT = `
require('node:fs').writeFileSync(process.argv[2], String(process.pid))
process.stdin.resume()
setInterval(() => {}, 1 << 30)
`

let fakeHomeDir: string
let workDir: string
let startedMarker: string
let previousUserDataPath: string | undefined

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${path}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeEach(() => {
  fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-real-home-async-home-'))
  workDir = mkdtempSync(join(tmpdir(), 'orca-real-home-async-work-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = join(workDir, 'user-data')
  homedirMock.mockReturnValue(fakeHomeDir)
  mkdirSync(join(fakeHomeDir, '.codex'), { recursive: true })
  const scriptPath = join(workDir, 'silent-codex.js')
  writeFileSync(scriptPath, SILENT_CODEX_SCRIPT)
  startedMarker = join(workDir, 'codex-started')
  _internals.setLaneForTesting('pending')
  grantInternals.resetDiagnostics()
  grantInternals.setGrantSessionRunner((request) =>
    runCodexHookTrustGrantSession({
      ...request,
      invocation: {
        ...request.invocation,
        command: process.execPath,
        args: [scriptPath, startedMarker]
      }
    })
  )
  grantInternals.setGrantSessionRunnerSync(() => {
    throw new Error('a blocking codex app-server session ran during startup')
  })
})

afterEach(() => {
  grantInternals.setGrantSessionRunner(null)
  grantInternals.setGrantSessionRunnerSync(null)
  grantInternals.resetDiagnostics()
  _internals.setLaneForTesting('pending')
  rmSync(fakeHomeDir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
})

describe('ensureRealHomeCodexHookStateAsync with a codex app-server that never answers', () => {
  it('keeps the event loop running and launch prep unblocked while the session is open', async () => {
    let settled = false
    const ensure = ensureRealHomeCodexHookStateAsync({
      hooksEnabled: true,
      userDataPath: join(workDir, 'user-data')
    })
    void ensure.then(() => {
      settled = true
    })

    // Timers fire while codex is up: a blocking grant would only return after its deadline.
    await waitForFile(startedMarker)
    expect(settled).toBe(false)
    expect(isRealHomeCodexHookLaneUsable()).toBe(false)

    // Launch prep during the session neither blocks nor starts a second transaction.
    expect(
      ensureRealHomeCodexHookState({
        hooksEnabled: true,
        userDataPath: workDir
      })
    ).toBe('pending')
    const managedHome = join(workDir, 'managed-home')
    mkdirSync(managedHome, { recursive: true })
    expect(
      grantManagedCodexHookTrust({
        runtimeHomePath: managedHome,
        tomlPath: join(managedHome, 'config.toml'),
        managedCommand: 'orca-hook',
        managedEntries: [
          {
            sourcePath: join(managedHome, 'hooks.json'),
            eventLabel: 'stop',
            groupIndex: 0,
            handlerIndex: 0,
            command: 'orca-hook',
            timeoutSec: 10
          }
        ],
        host: { kind: 'native' },
        telemetryLane: 'managed'
      })
    ).toEqual({ lane: 'fallback', reason: 'retry-cached' })

    process.kill(Number(readFileSync(startedMarker, 'utf-8')), 'SIGKILL')
    await expect(ensure).resolves.toBe('unavailable')
    expect(isRealHomeCodexHookLaneUsable()).toBe(false)
    // The untrusted entry was rolled back out of the user's real home.
    expect(existsSync(join(fakeHomeDir, '.codex', 'hooks.json'))).toBe(false)
  }, 30_000)
})
