import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { installOrchestratorGamePlugin } from './orchestrator-game-plugin-install'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-install-'))
  dirs.push(dir)
  return dir
}

function pluginSource(version = '0.1.0'): string {
  const dir = join(tempDir(), 'claude-plugins', 'orca-game')
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'orca-game', version })
  )
  writeFileSync(join(dir, 'hooks', 'index.ts'), 'export {}\n')
  return dir
}

const BUNDLED_PLUGIN = fileURLToPath(
  new URL('../../../resources/claude-plugins/orca-game', import.meta.url)
)
// ORCA-1140's V30 terminal format: palette, heading, live line, and the layer that draws them.
const FORMAT_MODULES = [
  'hooks/terminal-palette.ts',
  'hooks/text-layer.tsx',
  'hooks/message-heading.ts',
  'hooks/message-heading-words.ts',
  'hooks/live-line.ts',
  'hooks/live-turn.ts',
  'hooks/fleet-sync.ts'
]
const RELATIVE_IMPORT = /(?:from|import)\s*'(\.{1,2}\/[^']+)'/g
const IMPORT_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx', '/index.d.ts']

/** Plugin-relative paths of every module Claude Code loads from the copy's hooks.json. */
function registeredModulesOf(pluginDir: string): Set<string> {
  const hooksDir = join(pluginDir, 'hooks')
  const { modules } = JSON.parse(readFileSync(join(hooksDir, 'hooks.json'), 'utf8')) as {
    modules: string[]
  }
  const seen = new Set<string>()
  const visit = (file: string): void => {
    const key = relative(pluginDir, file).split('\\').join('/')
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const base = join(dirname(file), spec)
      const target = IMPORT_SUFFIXES.map((suffix) => base + suffix).find((path) =>
        statSync(path, { throwIfNoEntry: false })?.isFile()
      )
      expect(target, `${key} imports ${spec}, missing from the copy`).toBeDefined()
      visit(target!)
    }
  }
  for (const module of modules) {
    visit(join(hooksDir, module))
  }
  return seen
}

describe('installOrchestratorGamePlugin', () => {
  it('installs the real bundled plugin with the V30 terminal format registered and unchanged', async () => {
    const installed = await installOrchestratorGamePlugin({
      sourceDir: BUNDLED_PLUGIN,
      installRoot: tempDir()
    })

    const registered = registeredModulesOf(installed)
    expect([...registered]).toEqual(expect.arrayContaining(FORMAT_MODULES))
    for (const module of registered) {
      expect(readFileSync(join(installed, module), 'utf8'), module).toBe(
        readFileSync(join(BUNDLED_PLUGIN, module), 'utf8')
      )
    }
    const palette = (await import(
      pathToFileURL(join(installed, 'hooks', 'terminal-palette.ts')).href
    )) as { terminalPalette: () => Record<string, string> }
    // V30's dark values, as orca-game-terminal-colours.spec.ts measures them on rendered pixels.
    expect(palette.terminalPalette()).toEqual({
      head: '#e6e8ec',
      dim: '#8b93a1',
      rule: '#5a5d64',
      ask: '#ffb7b8',
      askRule: '#614f55',
      waiting: '#ff6568',
      done: '#8fce8f'
    })
  })

  it('copies the bundled plugin under the install root, outside the source', async () => {
    const sourceDir = pluginSource()
    const installRoot = tempDir()

    const installed = await installOrchestratorGamePlugin({ sourceDir, installRoot })

    expect(relative(installRoot, installed).startsWith('..')).toBe(false)
    expect(relative(sourceDir, installed).startsWith('..')).toBe(true)
    expect(existsSync(join(installed, '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(existsSync(join(installed, 'hooks', 'index.ts'))).toBe(true)
  })

  it('reuses the same copy for unchanged content and leaves no temp dirs', async () => {
    const sourceDir = pluginSource()
    const installRoot = tempDir()

    const first = await installOrchestratorGamePlugin({ sourceDir, installRoot })
    // Why: Claude Code writes .claude-plugin/types/ into the copy; that must not force a reinstall.
    mkdirSync(join(first, '.claude-plugin', 'types'))
    const second = await installOrchestratorGamePlugin({ sourceDir, installRoot })

    expect(second).toBe(first)
    expect(readdirSync(installRoot)).toEqual([relative(installRoot, first)])
  })

  it('installs changed content to a new dir and keeps only the current and previous copies', async () => {
    const installRoot = tempDir()
    const installed: string[] = []
    for (const [index, version] of ['0.1.0', '0.2.0', '0.3.0'].entries()) {
      const dir = await installOrchestratorGamePlugin({
        sourceDir: pluginSource(version),
        installRoot
      })
      // Why: copies made within one second share an mtime on some filesystems.
      const at = new Date(Date.now() - (10 - index) * 60_000)
      utimesSync(dir, at, at)
      installed.push(dir)
    }

    expect(new Set(installed).size).toBe(3)
    expect(readdirSync(installRoot).sort()).toEqual(
      [installed[1], installed[2]].map((dir) => relative(installRoot, dir)).sort()
    )
  })

  it('settles concurrent installs of the same content on one copy', async () => {
    const sourceDir = pluginSource()
    const installRoot = tempDir()

    const results = await Promise.all(
      Array.from({ length: 4 }, () => installOrchestratorGamePlugin({ sourceDir, installRoot }))
    )

    expect(new Set(results).size).toBe(1)
    expect(readdirSync(installRoot)).toEqual([relative(installRoot, results[0])])
  })
})
