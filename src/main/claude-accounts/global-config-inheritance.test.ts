import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearMcpServersFromVaultConfig,
  collectGlobalMcpServers,
  ensureVaultSkillsSymlink,
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
