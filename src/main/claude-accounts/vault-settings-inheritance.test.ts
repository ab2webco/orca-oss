import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildInheritedVaultSettings,
  describeVaultSettingsInheritance
} from './vault-settings-inheritance'
import {
  OUTPUT_STYLE_LINK_TYPE,
  listOutputStyleNames,
  outputStyleResolvesInVault
} from './vault-output-styles'

// Isolated fake home + vault: the real account vaults hold live credentials and
// must never be written by a test.
let root: string
let home: string
let vault: string

function writeHomeSettings(settings: Record<string, unknown>): void {
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
}

function readVaultSettings(): string | null {
  try {
    return readFileSync(join(vault, 'settings.json'), 'utf-8')
  } catch {
    return null
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-189-'))
  home = join(root, 'home')
  vault = join(root, 'vault', 'auth')
  mkdirSync(join(home, '.claude', 'output-styles'), { recursive: true })
  mkdirSync(vault, { recursive: true })
  writeFileSync(
    join(home, '.claude', 'output-styles', 'fried-brain.md'),
    '---\nname: Fried brain (shareable)\ndescription: short\n---\n\nbody\n'
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('output style resolution', () => {
  it('resolves a style by its frontmatter name, not its filename', () => {
    expect(listOutputStyleNames(join(home, '.claude', 'output-styles'))).toEqual([
      'Fried brain (shareable)'
    ])
  })

  // Node ignores the link type on POSIX, so only this assertion catches it: a
  // 'junction' needs a directory target and would throw on every .md on Windows.
  it('links styles as files, never as a Windows junction', () => {
    expect(OUTPUT_STYLE_LINK_TYPE).toBe('file')
  })

  it('links the home styles into the vault so the name resolves there', () => {
    writeHomeSettings({ outputStyle: 'Fried brain (shareable)' })
    expect(outputStyleResolvesInVault(vault, 'Fried brain (shareable)')).toBe(false)
    buildInheritedVaultSettings(vault, home, null)
    expect(outputStyleResolvesInVault(vault, 'Fried brain (shareable)')).toBe(true)
  })

  it('inherits outputStyle only when a style file backs the name', () => {
    writeHomeSettings({ outputStyle: 'A style with no file' })
    expect(buildInheritedVaultSettings(vault, home, null)).toBeNull()
    writeHomeSettings({ outputStyle: 'Fried brain (shareable)' })
    const merged = buildInheritedVaultSettings(vault, home, null)
    expect(JSON.parse(merged ?? '{}').outputStyle).toBe('Fried brain (shareable)')
  })

  it('leaves a hand-fixed vault style file alone instead of replacing it with a link', () => {
    mkdirSync(join(vault, 'output-styles'), { recursive: true })
    writeFileSync(
      join(vault, 'output-styles', 'fried-brain.md'),
      '---\nname: Fried brain (shareable)\n---\n\nlocal copy\n'
    )
    writeHomeSettings({ outputStyle: 'Fried brain (shareable)' })
    buildInheritedVaultSettings(vault, home, null)
    expect(readFileSync(join(vault, 'output-styles', 'fried-brain.md'), 'utf-8')).toContain(
      'local copy'
    )
  })
})

describe('buildInheritedVaultSettings', () => {
  it('leaves Orca instrumentation and the custom-endpoint token untouched', () => {
    writeHomeSettings({
      includeCoAuthoredBy: false,
      statusLine: { type: 'command', command: 'home-status' },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'home-hook' }] }] },
      env: { ANTHROPIC_AUTH_TOKEN: 'home-token' }
    })
    const existing = JSON.stringify({
      statusLine: { type: 'command', command: 'orca-status' },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'orca-hook' }] }] },
      env: { ANTHROPIC_AUTH_TOKEN: 'vault-token' }
    })
    const parsed = JSON.parse(buildInheritedVaultSettings(vault, home, existing) ?? '{}')
    expect(parsed.statusLine.command).toBe('orca-status')
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe('orca-hook')
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('vault-token')
    expect(parsed.includeCoAuthoredBy).toBe(false)
  })

  it('writes nothing on the second launch of an already-inherited vault', () => {
    writeHomeSettings({ includeCoAuthoredBy: false, attribution: { commit: '', pr: '' } })
    const first = buildInheritedVaultSettings(vault, home, null)
    expect(first).not.toBeNull()
    expect(buildInheritedVaultSettings(vault, home, first)).toBeNull()
  })

  it('degrades to no write when the home file is missing or unparseable', () => {
    rmSync(join(home, '.claude', 'settings.json'), { force: true })
    expect(buildInheritedVaultSettings(vault, home, '{}')).toBeNull()
    writeFileSync(join(home, '.claude', 'settings.json'), '{not json')
    expect(buildInheritedVaultSettings(vault, home, '{}')).toBeNull()
  })
})

describe('describeVaultSettingsInheritance', () => {
  function describe_(): ReturnType<typeof describeVaultSettingsInheritance> {
    return describeVaultSettingsInheritance({
      accountId: 'acct-1',
      vaultAuthPath: vault,
      homeDir: home,
      readVaultSettings
    })
  }

  function stateOf(key: string): string | undefined {
    const report = describe_()
    return report.state === 'vault'
      ? report.keys.find((entry) => entry.key === key)?.state
      : undefined
  }

  it('reports the measured defect: every user key absent from a fresh vault', () => {
    writeHomeSettings({
      includeCoAuthoredBy: false,
      attribution: { commit: '', pr: '' },
      permissions: { allow: ['Bash(ls)'] },
      skillOverrides: { 'branch-pr': 'always' },
      agentPushNotifEnabled: true
    })
    writeFileSync(join(vault, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    expect(stateOf('includeCoAuthoredBy')).toBe('stale')
    expect(stateOf('permissions')).toBe('stale')
    expect(stateOf('outputStyle')).toBe('absent')
  })

  it('reports inherited after the launch-time merge ran', () => {
    writeHomeSettings({
      includeCoAuthoredBy: false,
      attribution: { commit: '', pr: '' },
      outputStyle: 'Fried brain (shareable)'
    })
    const merged = buildInheritedVaultSettings(vault, home, null)
    writeFileSync(join(vault, 'settings.json'), merged ?? '{}')
    expect(stateOf('includeCoAuthoredBy')).toBe('inherited')
    expect(stateOf('attribution')).toBe('inherited')
    expect(stateOf('outputStyle')).toBe('inherited')
  })

  it('reports stale — not inherited — when home changed after the session launched', () => {
    writeHomeSettings({ includeCoAuthoredBy: false })
    writeFileSync(
      join(vault, 'settings.json'),
      buildInheritedVaultSettings(vault, home, null) ?? ''
    )
    writeHomeSettings({ includeCoAuthoredBy: false, attribution: { commit: '', pr: '' } })
    expect(stateOf('includeCoAuthoredBy')).toBe('inherited')
    expect(stateOf('attribution')).toBe('stale')
  })

  it('reports unresolved for an outputStyle with no file behind it', () => {
    writeHomeSettings({ outputStyle: 'A style with no file' })
    expect(stateOf('outputStyle')).toBe('unresolved')
  })

  it('follows a symlinked style so a linked vault resolves the name', () => {
    mkdirSync(join(vault, 'output-styles'), { recursive: true })
    symlinkSync(
      join(home, '.claude', 'output-styles', 'fried-brain.md'),
      join(vault, 'output-styles', 'fried-brain.md')
    )
    writeHomeSettings({ outputStyle: 'Fried brain (shareable)' })
    expect(stateOf('outputStyle')).toBe('stale')
  })
})
