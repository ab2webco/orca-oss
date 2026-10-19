import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  diffTreeSnapshots,
  pluginDirsInsideApp,
  sealVerdict,
  simulateClaudePluginWrite,
  snapshotTree
} from './verify-packaged-claude-plugin-seal.mjs'

let root
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'orca-663-seal-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeApp() {
  const appRoot = path.join(root, 'Orca.app')
  const pluginDir = path.join(appRoot, 'Contents', 'Resources', 'claude-plugins', 'orca-game')
  mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true })
  writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), '{"name":"orca-game"}')
  return { appRoot, pluginDir }
}

describe('pluginDirsInsideApp', () => {
  it('flags the lab.102 plugin dir, which sits in the app resources', () => {
    const { appRoot, pluginDir } = makeApp()
    expect(pluginDirsInsideApp({ pluginDirs: [pluginDir], appRoot, platform: 'darwin' })).toEqual([
      pluginDir
    ])
  })

  it('passes the ORCA-662 copy under userData', () => {
    const { appRoot } = makeApp()
    const copy = path.join(root, 'user-data', 'claude-plugins', 'orca-game-0123456789abcdef')
    mkdirSync(copy, { recursive: true })
    expect(pluginDirsInsideApp({ pluginDirs: [copy], appRoot, platform: 'darwin' })).toEqual([])
  })

  it('flags a dir outside the app that links back into it', () => {
    const { appRoot, pluginDir } = makeApp()
    const link = path.join(root, 'user-data-link')
    symlinkSync(pluginDir, link, 'dir')
    expect(pluginDirsInsideApp({ pluginDirs: [link], appRoot, platform: 'linux' })).toEqual([link])
  })

  it('does not read a sibling that only shares the app path as a prefix', () => {
    const { appRoot } = makeApp()
    const sibling = path.join(root, 'Orca.app-copy', 'orca-game')
    mkdirSync(sibling, { recursive: true })
    expect(pluginDirsInsideApp({ pluginDirs: [sibling], appRoot, platform: 'darwin' })).toEqual([])
  })

  it('compares case-insensitively only where the filesystem does', () => {
    const appRoot = '/Applications/Orca.app'
    const pluginDir = '/applications/orca.app/Contents/Resources/claude-plugins/orca-game'
    const realpath = (value) => value
    expect(
      pluginDirsInsideApp({ pluginDirs: [pluginDir], appRoot, platform: 'darwin', realpath })
    ).toEqual([pluginDir])
    expect(
      pluginDirsInsideApp({ pluginDirs: [pluginDir], appRoot, platform: 'linux', realpath })
    ).toEqual([])
  })

  it('reads Windows paths with win32 rules and folded case', () => {
    const appRoot = 'D:\\a\\orca-oss\\dist\\win-unpacked'
    const inside = 'd:\\A\\orca-oss\\dist\\WIN-UNPACKED\\resources\\claude-plugins\\orca-game'
    const outside = 'C:\\Users\\runner\\AppData\\Roaming\\Orca\\claude-plugins\\orca-game-0123'
    const realpath = (value) => value
    expect(
      pluginDirsInsideApp({ pluginDirs: [inside, outside], appRoot, platform: 'win32', realpath })
    ).toEqual([inside])
  })
})

describe('tree snapshots', () => {
  it('reports nothing for an untouched tree', () => {
    const { appRoot } = makeApp()
    expect(diffTreeSnapshots(snapshotTree(appRoot), snapshotTree(appRoot))).toEqual([])
  })

  it('reports the types dir Claude Code writes into an in-app plugin dir', () => {
    const { appRoot, pluginDir } = makeApp()
    const before = snapshotTree(appRoot)
    simulateClaudePluginWrite(pluginDir)
    const typesDir = 'Contents/Resources/claude-plugins/orca-game/.claude-plugin/types'
    expect(diffTreeSnapshots(before, snapshotTree(appRoot))).toEqual([
      `added ${typesDir}`,
      `added ${typesDir}/orca-663-probe.d.ts`
    ])
  })

  it('reports a rewritten file and a removed one', () => {
    const { appRoot, pluginDir } = makeApp()
    writeFileSync(path.join(pluginDir, 'hooks.json'), '{}')
    const before = snapshotTree(appRoot)
    writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), '{"name":"changed"}')
    rmSync(path.join(pluginDir, 'hooks.json'))
    expect(diffTreeSnapshots(before, snapshotTree(appRoot))).toEqual([
      'changed Contents/Resources/claude-plugins/orca-game/.claude-plugin/plugin.json',
      'removed Contents/Resources/claude-plugins/orca-game/hooks.json'
    ])
  })

  it('records a symlink by its target, without following it', () => {
    const { appRoot } = makeApp()
    symlinkSync('Resources', path.join(appRoot, 'Contents', 'Current'))
    const before = snapshotTree(appRoot)
    expect(before.get('Contents/Current')).toBe('link:Resources')
    rmSync(path.join(appRoot, 'Contents', 'Current'))
    symlinkSync('MacOS', path.join(appRoot, 'Contents', 'Current'))
    expect(diffTreeSnapshots(before, snapshotTree(appRoot))).toEqual(['changed Contents/Current'])
  })
})

describe('sealVerdict', () => {
  const appRoot = '/dist/mac-arm64/Orca.app'
  const outside = '/tmp/user-data/claude-plugins/orca-game-0123456789abcdef'

  it('passes when every dir is outside the app and nothing changed', () => {
    expect(
      sealVerdict({
        appRoot,
        pluginDirs: [outside],
        insideApp: [],
        treeChanges: [],
        codesign: null
      })
    ).toEqual({ ok: true, failures: [] })
  })

  it('refuses to attest when the app handed Claude no plugin dir', () => {
    const verdict = sealVerdict({
      appRoot,
      pluginDirs: [],
      insideApp: [],
      treeChanges: [],
      codesign: null
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures[0]).toMatch(/^ORCA-663 no-plugin-dir: /)
  })

  it('names every failed check, with the paths behind it', () => {
    const inside = `${appRoot}/Contents/Resources/claude-plugins/orca-game`
    const verdict = sealVerdict({
      appRoot,
      pluginDirs: [inside],
      insideApp: [inside],
      treeChanges: ['added Contents/Resources/claude-plugins/orca-game/.claude-plugin/types'],
      codesign: { ok: false, output: 'a sealed resource is missing or invalid' }
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures).toHaveLength(3)
    expect(verdict.failures[0]).toMatch(/^ORCA-663 plugin-dir-inside-app: /)
    expect(verdict.failures[0]).toContain(inside)
    expect(verdict.failures[1]).toMatch(/^ORCA-663 app-tree-changed: /)
    expect(verdict.failures[1]).toContain('.claude-plugin/types')
    expect(verdict.failures[2]).toMatch(/^ORCA-663 codesign-seal-broken: /)
    expect(verdict.failures[2]).toContain('a sealed resource is missing or invalid')
  })
})
