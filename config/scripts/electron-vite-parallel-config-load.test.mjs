import fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadConfigFromFile } from 'electron-vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: run-electron-vite-targets-in-parallel.mjs loads one config from three processes at once.
// A temp name shared within a millisecond lets one build truncate or unlink another's (ORCA-930).
describe('electron-vite config loading for parallel target builds', () => {
  let root

  afterEach(async () => {
    vi.restoreAllMocks()
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes each load to its own temp file even within one millisecond', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'orca-electron-vite-config-'))
    const configFile = path.join(root, 'target.config.mjs')
    await writeFile(configFile, 'export default { main: {}, preload: {}, renderer: {} }\n')
    vi.spyOn(Date, 'now').mockReturnValue(1_793_000_000_000)
    const writeFileSync = vi.spyOn(fs, 'writeFileSync')

    for (let load = 0; load < 2; load += 1) {
      const { config } = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        configFile,
        root,
        'silent',
        true
      )
      expect(config).toEqual({ main: {}, preload: {}, renderer: {} })
    }

    const tempFiles = writeFileSync.mock.calls
      .map(([file]) => String(file))
      .filter((file) => path.dirname(file) === root)
    expect(tempFiles).toHaveLength(2)
    expect(new Set(tempFiles).size).toBe(2)
  })
})
