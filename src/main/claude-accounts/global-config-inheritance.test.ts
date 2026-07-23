import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearMcpServersFromVaultConfig,
  collectGlobalMcpServerEntries,
  collectGlobalMcpServers,
  ensureSelectiveVaultSkills,
  ensureVaultSkillsSymlink,
  listGlobalSkillNames,
  mergeMcpServersIntoVaultConfig,
  removeVaultSkillsSymlink
} from './global-config-inheritance'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'orca-global-config-'))
}

function writeGlobalConfig(home: string, mcpServers: Record<string, unknown>): void {
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers, other: 1 }))
}

describe('collectGlobalMcpServers', () => {
  it('returns the user-scope mcpServers from ~/.claude.json', () => {
    const home = makeHome()
    writeGlobalConfig(home, { lune: { command: 'lune' }, plane: { command: 'plane' } })
    expect(collectGlobalMcpServers(home)).toEqual({
      lune: { command: 'lune' },
      plane: { command: 'plane' }
    })
  })

  it('also merges settings.json mcpServers and standalone ~/.claude/mcp/*.json (plugin MCPs)', () => {
    const home = makeHome()
    writeGlobalConfig(home, { lune: { command: 'lune' } })
    mkdirSync(join(home, '.claude', 'mcp'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { context7: { command: 'npx' } } })
    )
    writeFileSync(
      join(home, '.claude', 'mcp', 'engram.json'),
      JSON.stringify({ command: '/opt/homebrew/bin/engram', args: ['mcp', '--tools=agent'] })
    )
    expect(collectGlobalMcpServers(home)).toEqual({
      lune: { command: 'lune' },
      context7: { command: 'npx' },
      engram: { command: '/opt/homebrew/bin/engram', args: ['mcp', '--tools=agent'] }
    })
  })

  it('ignores ~/.claude/mcp files without a command', () => {
    const home = makeHome()
    mkdirSync(join(home, '.claude', 'mcp'), { recursive: true })
    writeFileSync(join(home, '.claude', 'mcp', 'broken.json'), JSON.stringify({ args: [] }))
    writeFileSync(join(home, '.claude', 'mcp', 'notjson.json'), '{ nope')
    expect(collectGlobalMcpServers(home)).toBeNull()
  })

  it('returns null when there are no servers anywhere', () => {
    expect(collectGlobalMcpServers(makeHome())).toBeNull()
  })
})

describe('mergeMcpServersIntoVaultConfig', () => {
  const global = { context7: { command: 'npx' } }

  it('seeds mcpServers into an empty vault config', () => {
    const result = mergeMcpServersIntoVaultConfig(null, global)
    expect(result).not.toBeNull()
    expect(JSON.parse(result as string)).toEqual({ mcpServers: global })
  })

  it('preserves other CLI-managed keys while adding mcpServers', () => {
    const existing = JSON.stringify({ oauthAccount: { id: 'x' }, projects: {} })
    const parsed = JSON.parse(mergeMcpServersIntoVaultConfig(existing, global) as string)
    expect(parsed.oauthAccount).toEqual({ id: 'x' })
    expect(parsed.projects).toEqual({})
    expect(parsed.mcpServers).toEqual(global)
  })

  it('lets global entries win but keeps vault-only servers', () => {
    const existing = JSON.stringify({
      mcpServers: { context7: { command: 'old' }, localOnly: { command: 'keep' } }
    })
    const parsed = JSON.parse(mergeMcpServersIntoVaultConfig(existing, global) as string)
    expect(parsed.mcpServers).toEqual({
      context7: { command: 'npx' },
      localOnly: { command: 'keep' }
    })
  })

  it('returns null (idempotent) when every global entry already matches', () => {
    const existing = JSON.stringify({ mcpServers: { context7: { command: 'npx' } }, extra: true })
    expect(mergeMcpServersIntoVaultConfig(existing, global)).toBeNull()
  })

  it('returns null when the vault config is unparseable (never clobbers)', () => {
    expect(mergeMcpServersIntoVaultConfig('{ broken', global)).toBeNull()
  })
})

describe('clearMcpServersFromVaultConfig', () => {
  it('removes mcpServers but keeps other CLI-managed keys', () => {
    const existing = JSON.stringify({
      mcpServers: { engram: { command: 'x' } },
      oauthAccount: { id: 'y' }
    })
    const parsed = JSON.parse(clearMcpServersFromVaultConfig(existing) as string)
    expect(parsed.mcpServers).toBeUndefined()
    expect(parsed.oauthAccount).toEqual({ id: 'y' })
  })

  it('returns null when there is nothing to remove', () => {
    expect(clearMcpServersFromVaultConfig(null)).toBeNull()
    expect(clearMcpServersFromVaultConfig(JSON.stringify({ oauthAccount: {} }))).toBeNull()
    expect(clearMcpServersFromVaultConfig('{ broken')).toBeNull()
  })
})

describe('removeVaultSkillsSymlink', () => {
  it('unlinks our skills symlink', () => {
    const home = makeHome()
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })
    ensureVaultSkillsSymlink(vault, home)
    expect(removeVaultSkillsSymlink(vault)).toBe(true)
    expect(existsSync(join(vault, 'skills'))).toBe(false)
  })

  it('leaves a real directory alone and returns false', () => {
    const vault = join(makeHome(), 'auth')
    mkdirSync(join(vault, 'skills'), { recursive: true })
    expect(removeVaultSkillsSymlink(vault)).toBe(false)
    expect(lstatSync(join(vault, 'skills')).isDirectory()).toBe(true)
  })
})

describe('ensureVaultSkillsSymlink', () => {
  afterEach(() => {
    // temp dirs are left for the OS to clean; nothing persistent to reset
  })

  it('links <vault>/skills to the global skills dir', () => {
    const home = makeHome()
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })

    expect(ensureVaultSkillsSymlink(vault, home)).toBe('linked')
    const linkPath = join(vault, 'skills')
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(linkPath)).toBe(join(home, '.claude', 'skills'))
  })

  it('skips when there are no global skills', () => {
    const home = makeHome()
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })
    expect(ensureVaultSkillsSymlink(vault, home)).toBe('skipped')
    expect(existsSync(join(vault, 'skills'))).toBe(false)
  })

  it('never clobbers an existing <vault>/skills entry', () => {
    const home = makeHome()
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    const vault = join(makeHome(), 'auth')
    mkdirSync(join(vault, 'skills'), { recursive: true })
    expect(ensureVaultSkillsSymlink(vault, home)).toBe('exists')
    expect(lstatSync(join(vault, 'skills')).isDirectory()).toBe(true)
  })
})

function makeSkills(home: string, names: string[]): void {
  for (const name of names) {
    mkdirSync(join(home, '.claude', 'skills', name), { recursive: true })
  }
}

describe('listGlobalSkillNames', () => {
  it('lists global skill directory names sorted', () => {
    const home = makeHome()
    makeSkills(home, ['zebra', 'alpha'])
    expect(listGlobalSkillNames(home)).toEqual(['alpha', 'zebra'])
  })

  it('returns [] when there is no global skills dir', () => {
    expect(listGlobalSkillNames(makeHome())).toEqual([])
  })
})

describe('collectGlobalMcpServerEntries', () => {
  it('reports each server with its source, letting the later source win', () => {
    const home = makeHome()
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { shared: {}, only1: {} } })
    )
    mkdirSync(join(home, '.claude', 'mcp'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { shared: {} } })
    )
    writeFileSync(
      join(home, '.claude', 'mcp', 'engram.json'),
      JSON.stringify({ command: 'engram' })
    )
    expect(collectGlobalMcpServerEntries(home)).toEqual([
      { name: 'engram', source: 'plugin-dir' },
      { name: 'only1', source: 'user-config' },
      { name: 'shared', source: 'settings' }
    ])
  })
})

describe('ensureSelectiveVaultSkills', () => {
  it('creates one live symlink per selected skill', () => {
    const home = makeHome()
    makeSkills(home, ['a', 'b', 'c'])
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })

    ensureSelectiveVaultSkills(vault, home, ['a', 'c'])
    const skillsDir = join(vault, 'skills')
    expect(lstatSync(skillsDir).isDirectory()).toBe(true)
    expect(lstatSync(join(skillsDir, 'a')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(skillsDir, 'a'))).toBe(join(home, '.claude', 'skills', 'a'))
    expect(existsSync(join(skillsDir, 'b'))).toBe(false)
    expect(lstatSync(join(skillsDir, 'c')).isSymbolicLink()).toBe(true)
  })

  it('migrates a legacy whole-dir symlink and prunes deselected skills', () => {
    const home = makeHome()
    makeSkills(home, ['a', 'b'])
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })

    ensureVaultSkillsSymlink(vault, home) // legacy whole-dir link
    expect(lstatSync(join(vault, 'skills')).isSymbolicLink()).toBe(true)

    ensureSelectiveVaultSkills(vault, home, ['a', 'b'])
    ensureSelectiveVaultSkills(vault, home, ['a']) // now deselect b
    const skillsDir = join(vault, 'skills')
    expect(lstatSync(skillsDir).isDirectory()).toBe(true)
    expect(existsSync(join(skillsDir, 'a'))).toBe(true)
    expect(existsSync(join(skillsDir, 'b'))).toBe(false)
  })

  it('skips a selected skill that does not exist globally', () => {
    const home = makeHome()
    makeSkills(home, ['a'])
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })
    ensureSelectiveVaultSkills(vault, home, ['a', 'ghost'])
    expect(existsSync(join(vault, 'skills', 'a'))).toBe(true)
    expect(existsSync(join(vault, 'skills', 'ghost'))).toBe(false)
  })
})

describe('removeVaultSkillsSymlink (selective dir)', () => {
  it('prunes per-skill symlinks and removes the emptied dir', () => {
    const home = makeHome()
    makeSkills(home, ['a', 'b'])
    const vault = join(makeHome(), 'auth')
    mkdirSync(vault, { recursive: true })
    ensureSelectiveVaultSkills(vault, home, ['a', 'b'])
    expect(removeVaultSkillsSymlink(vault)).toBe(true)
    expect(existsSync(join(vault, 'skills'))).toBe(false)
  })
})
