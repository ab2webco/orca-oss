import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureVaultSkillsSymlink,
  mergeMcpServersIntoVaultConfig,
  readGlobalMcpServers
} from './global-config-inheritance'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'orca-global-config-'))
}

describe('readGlobalMcpServers', () => {
  it('returns the mcpServers map when present', () => {
    const home = makeHome()
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { context7: { command: 'npx', args: ['ctx'] } }, other: 1 })
    )
    expect(readGlobalMcpServers(home)).toEqual({ context7: { command: 'npx', args: ['ctx'] } })
  })

  it('returns null when the file is missing', () => {
    expect(readGlobalMcpServers(makeHome())).toBeNull()
  })

  it('returns null when mcpServers is absent or empty', () => {
    const home = makeHome()
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }))
    expect(readGlobalMcpServers(home)).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    const home = makeHome()
    writeFileSync(join(home, '.claude.json'), '{ not json')
    expect(readGlobalMcpServers(home)).toBeNull()
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
