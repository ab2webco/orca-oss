// Why these run against real temp universes: vault creation clones the shared home
// settings.json, so a stale copy of the user's personal statusLine can sit in any vault and
// silently block the managed line for pinned launches — detection and consented replacement
// must therefore see every universe, not just ~/.claude.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, afterEach, describe, expect, it } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/userData'
  }
}))

vi.mock('./hook-event-versions', async (importActual) => {
  const actual = await importActual<typeof HookEventVersionsModule>()
  return { ...actual, detectClaudeCodeVersion: () => '2.1.218' }
})

import type * as HookEventVersionsModule from './hook-event-versions'
import type { ClaudeManagedAccount } from '../../shared/types'
import { ClaudeHookService } from './hook-service'
import {
  configureClaudeStatusLineOwnershipAccounts,
  getClaudeStatusLineOwnership,
  replaceUserOwnedClaudeStatusLines
} from './statusline-ownership'

const USER_STATUSLINE = { type: 'command', command: '/usr/local/bin/my-statusline' }

function makeAccount(
  id: string,
  managedAuthPath: string,
  overrides: Partial<ClaudeManagedAccount> = {}
): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@acme.dev`,
    managedAuthPath,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...overrides
  }
}

describe('claude statusline ownership', () => {
  const tmpDirs: string[] = []

  function makeTmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    configureClaudeStatusLineOwnershipAccounts(() => [])
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function stubHome(): string {
    const home = makeTmpDir('orca-statusline-own-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    return home
  }

  function writeHomeSettings(home: string, settings: Record<string, unknown>): string {
    const settingsPath = join(home, '.claude', 'settings.json')
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings))
    return settingsPath
  }

  function makeVault(settings: Record<string, unknown> | null): string {
    const vault = join(makeTmpDir('orca-statusline-own-vault-'), 'auth')
    mkdirSync(vault, { recursive: true })
    if (settings !== null) {
      writeFileSync(join(vault, 'settings.json'), JSON.stringify(settings))
    }
    return vault
  }

  it('reports a user-owned home slot and stale user copies inside vaults', () => {
    const home = stubHome()
    writeHomeSettings(home, { statusLine: USER_STATUSLINE })
    const userVault = makeVault({ statusLine: USER_STATUSLINE })
    const emptyVault = makeVault({})
    const wslVault = makeVault(null)
    configureClaudeStatusLineOwnershipAccounts(() => [
      makeAccount('acct-user', userVault),
      makeAccount('acct-empty', emptyVault),
      makeAccount('acct-wsl', wslVault, { managedAuthRuntime: 'wsl' })
    ])

    const ownership = getClaudeStatusLineOwnership()
    expect(ownership.userOwnedHome).toBe(true)
    expect(ownership.userOwnedVaultCount).toBe(1)
    const states = Object.fromEntries(
      ownership.universes.map((universe) => [universe.accountId ?? 'home', universe.state])
    )
    expect(states).toEqual({
      home: 'user',
      'acct-user': 'user',
      'acct-empty': 'empty',
      // Why unknown: the host cannot see a WSL vault's disk, so it must never claim a state.
      'acct-wsl': 'unknown'
    })
  })

  it('reports a managed home slot after install()', () => {
    stubHome()
    new ClaudeHookService().install()
    const ownership = getClaudeStatusLineOwnership()
    expect(ownership.userOwnedHome).toBe(false)
    expect(ownership.universes.find((u) => u.universe === 'home')?.state).toBe('managed')
  })

  it('replaces every consented user-owned slot and installs the managed line', () => {
    const home = stubHome()
    const settingsPath = writeHomeSettings(home, {
      statusLine: USER_STATUSLINE,
      env: { KEEP: '1' }
    })
    const userVault = makeVault({ statusLine: USER_STATUSLINE, theme: 'dark' })
    const managedFirst = makeVault({})
    configureClaudeStatusLineOwnershipAccounts(() => [
      makeAccount('acct-user', userVault),
      makeAccount('acct-managed', managedFirst)
    ])

    const service = new ClaudeHookService()
    const result = replaceUserOwnedClaudeStatusLines(service)
    expect(result.failedCount).toBe(0)
    expect(result.ownership.userOwnedHome).toBe(false)
    expect(result.ownership.userOwnedVaultCount).toBe(0)

    const homeSettings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      statusLine?: { command?: string }
      env?: Record<string, string>
    }
    expect(homeSettings.statusLine?.command).toContain('claude-statusline')
    // Consent covers only the statusLine slot — every other user key survives.
    expect(homeSettings.env).toEqual({ KEEP: '1' })

    const vaultSettings = JSON.parse(readFileSync(join(userVault, 'settings.json'), 'utf-8')) as {
      statusLine?: { command?: string }
      theme?: string
    }
    expect(vaultSettings.statusLine?.command).toContain('claude-statusline')
    expect(vaultSettings.statusLine?.command).not.toContain('my-statusline')
    expect(vaultSettings.theme).toBe('dark')
  })

  it('leaves already-managed universes untouched on replace', () => {
    const home = stubHome()
    const service = new ClaudeHookService()
    service.install()
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')
    const result = replaceUserOwnedClaudeStatusLines(service)
    expect(result.failedCount).toBe(0)
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')).toBe(before)
  })
})
