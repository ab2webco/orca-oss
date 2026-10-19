import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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

describe('installOrchestratorGamePlugin', () => {
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
