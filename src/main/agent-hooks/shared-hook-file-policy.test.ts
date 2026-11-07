// ORCA-1131: a dev Orca rewrote ~/.orca/agent-hooks/claude-statusline.sh and added 8 entries to
// ~/.codex/hooks.json, both owned by the installed Orca. These pin dev to byte-identical files.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { homedirMock, grantMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>(),
  grantMock: vi.fn()
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: homedirMock }
})

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: homedirMock }
})

vi.mock('electron', () => ({ app: { getPath: () => process.env.ORCA_USER_DATA_PATH } }))

vi.mock('../codex/codex-hook-trust-grant', () => ({
  CODEX_TRUST_GRANT_TRANSIENT_RETRY_INTERVAL_MS: 300_000,
  grantManagedCodexHookTrust: grantMock
}))

import { resolveSharedHookFilePolicy, setSharedHookFilePolicy } from './shared-hook-file-policy'
import { claudeHookService } from '../claude/hook-service'
import { getStatusLineScriptPath } from '../claude/hook-settings'
import { refreshManagedScriptIfPresent } from './managed-hook-script-refresh'
import {
  ensureRealHomeCodexHookState,
  _internals as realHomeInternals
} from '../codex/codex-real-home-hook-install'
import { codexHookService, getCodexManagedHookInstallMaterial } from '../codex/hook-service'

const INSTALLED_ORCA_STATUSLINE = '#!/bin/sh\n# written by the installed Orca, with its cost item\n'

let fakeHome = ''
let userData = ''
let previousUserDataPath: string | undefined

function codexHooksPath(): string {
  return join(fakeHome, '.codex', 'hooks.json')
}

function writeInstalledStatusLine(): string {
  const scriptPath = getStatusLineScriptPath()
  mkdirSync(join(fakeHome, '.orca', 'agent-hooks'), { recursive: true })
  writeFileSync(scriptPath, INSTALLED_ORCA_STATUSLINE, { mode: 0o755 })
  return scriptPath
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'orca-1131-home-'))
  userData = mkdtempSync(join(tmpdir(), 'orca-1131-user-data-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = userData
  homedirMock.mockReturnValue(fakeHome)
  mkdirSync(join(fakeHome, '.claude'), { recursive: true })
  mkdirSync(join(fakeHome, '.codex'), { recursive: true })
  writeFileSync(join(fakeHome, '.claude', 'settings.json'), '{}\n')
  grantMock.mockImplementation((plan: { managedEntries: object[] }) => ({
    lane: 'rpc',
    entries: plan.managedEntries.map((entry) => ({ ...entry, trustedHash: 'codex-hash' }))
  }))
  realHomeInternals.setLaneForTesting('pending')
})

afterEach(() => {
  setSharedHookFilePolicy('replace')
  claudeHookService.setHomeManagedHookPolicy('replace')
  rmSync(fakeHome, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  vi.clearAllMocks()
})

function useDevPolicy(): void {
  const policy = resolveSharedHookFilePolicy({ isPackaged: false, isE2E: false })
  setSharedHookFilePolicy(policy)
  claudeHookService.setHomeManagedHookPolicy(policy)
}

describe('resolveSharedHookFilePolicy', () => {
  it('keeps existing shared files only for an unpackaged, non-E2E instance', () => {
    expect(resolveSharedHookFilePolicy({ isPackaged: false, isE2E: false })).toBe('keep-existing')
    expect(resolveSharedHookFilePolicy({ isPackaged: true, isE2E: false })).toBe('replace')
    expect(resolveSharedHookFilePolicy({ isPackaged: false, isE2E: true })).toBe('replace')
  })
})

describe('claude-statusline.sh under a dev instance', () => {
  it('leaves the installed Orca script byte-identical on install()', () => {
    useDevPolicy()
    const scriptPath = writeInstalledStatusLine()

    claudeHookService.install()

    expect(readFileSync(scriptPath, 'utf-8')).toBe(INSTALLED_ORCA_STATUSLINE)
  })

  it('leaves it byte-identical on the startup refresh and the settings-change refresh', async () => {
    useDevPolicy()
    const scriptPath = writeInstalledStatusLine()

    await claudeHookService.refreshManagedScripts()
    claudeHookService.refreshManagedStatusLineScript()
    await refreshManagedScriptIfPresent(scriptPath, 'other content\n')

    expect(readFileSync(scriptPath, 'utf-8')).toBe(INSTALLED_ORCA_STATUSLINE)
  })

  it('still creates the script when no Orca installed one', () => {
    useDevPolicy()

    claudeHookService.install()

    expect(readFileSync(getStatusLineScriptPath(), 'utf-8')).not.toBe('')
  })

  it('packaged keeps rewriting the shared script', () => {
    const scriptPath = writeInstalledStatusLine()

    claudeHookService.install()

    expect(readFileSync(scriptPath, 'utf-8')).not.toBe(INSTALLED_ORCA_STATUSLINE)
  })
})

describe('~/.codex/hooks.json under a dev instance', () => {
  const userHooks = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }, null, 2)}\n`

  it('adds no Orca entry to the real Codex hooks and keeps the managed lane', () => {
    useDevPolicy()
    writeFileSync(codexHooksPath(), userHooks)

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userData })

    expect(readFileSync(codexHooksPath(), 'utf-8')).toBe(userHooks)
    expect(lane).toBe('unavailable')
    expect(grantMock).not.toHaveBeenCalled()
  })

  it('leaves the installed Orca entries in place when the managed lane installs', () => {
    useDevPolicy()
    const { command, events } = getCodexManagedHookInstallMaterial()
    const installed = `${JSON.stringify(
      {
        hooks: Object.fromEntries(
          events.map((event) => [event, [{ hooks: [{ type: 'command', command, timeout: 10 }] }]])
        )
      },
      null,
      2
    )}\n`
    writeFileSync(codexHooksPath(), installed)

    codexHookService.install()

    expect(readFileSync(codexHooksPath(), 'utf-8')).toBe(installed)
  })

  it('packaged still installs the real-home entry in every managed event', () => {
    writeFileSync(codexHooksPath(), userHooks)

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userData })

    expect(lane).toBe('installed')
    const config = JSON.parse(readFileSync(codexHooksPath(), 'utf-8'))
    const { command, events } = getCodexManagedHookInstallMaterial()
    for (const event of events) {
      expect(JSON.stringify(config.hooks[event])).toContain(JSON.stringify(command))
    }
  })
})
