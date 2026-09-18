import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashPluginTree } from '../../src/main/plugins/plugin-content-hash'

const require = createRequire(import.meta.url)
const { verifyPackagedPluginResources } = require('./verify-packaged-plugin-resources.cjs')

const LAUNCH_SOURCE = join(process.cwd(), 'resources', 'plugins', 'launch')

async function copyLaunchTree(resourcesDir) {
  const launchRoot = join(resourcesDir, 'plugins', 'launch')
  await cp(LAUNCH_SOURCE, launchRoot, { recursive: true })
  return launchRoot
}

/**
 * The shipped index is empty, so the hash checks below would never run against
 * it. These tests write their own index over the packaged copy, with baseline
 * hashes from the app's own `hashPluginTree` — which also keeps the two hash
 * implementations from drifting apart unnoticed.
 */
async function seedBundledIndex(launchRoot, directories) {
  const plugins = await Promise.all(
    directories.map(async (directory) => {
      const hashed = await hashPluginTree(join(launchRoot, directory))
      if (!hashed.ok) {
        throw new Error(`could not hash ${directory}: ${hashed.error}`)
      }
      return { pluginKey: directory, path: directory, contentHash: hashed.hash }
    })
  )
  await writeFile(
    join(launchRoot, 'bundled-plugins.json'),
    `${JSON.stringify({ version: 1, plugins }, null, 2)}\n`
  )
}

describe('verify packaged plugin resources', () => {
  it('accepts the shipped launch bytes, whose bundled index auto-installs nothing', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-plugins-'))
    try {
      const launchRoot = await copyLaunchTree(resourcesDir)
      const index = JSON.parse(await readFile(join(launchRoot, 'bundled-plugins.json'), 'utf8'))

      expect(index.plugins).toEqual([])
      expect(() => verifyPackagedPluginResources(resourcesDir)).not.toThrow()
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('rejects an index that is not a plugin list at all', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-plugins-'))
    try {
      const launchRoot = await copyLaunchTree(resourcesDir)
      await writeFile(join(launchRoot, 'bundled-plugins.json'), '{"version":1}\n')

      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        'bundled plugin index is invalid'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('rejects mutated bytes in the packaged output', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-plugins-'))
    try {
      const launchRoot = await copyLaunchTree(resourcesDir)
      await seedBundledIndex(launchRoot, ['stablyai.orca-navigation-shortcuts'])
      await writeFile(
        join(launchRoot, 'stablyai.orca-navigation-shortcuts', 'extra.json'),
        '{"mutated":true}\n'
      )

      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        'packaged bytes do not match stablyai.orca-navigation-shortcuts'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  // The tree is hashed by raw bytes, so a CRLF checkout on Windows breaks the
  // pinned hash. These two guard the `.gitattributes` eol=lf pin that prevents it.
  it('pins the launch tree to LF so Windows checkouts hash identically', async () => {
    const attributes = await readFile(join(process.cwd(), '.gitattributes'), 'utf8')
    expect(attributes).toContain('/resources/plugins/** text eol=lf')
  })

  it('rejects a CRLF checkout of the launch tree', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-plugins-'))
    try {
      const launchRoot = await copyLaunchTree(resourcesDir)
      const directories = (await readdir(launchRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
      await seedBundledIndex(launchRoot, directories)
      for (const entry of await readdir(launchRoot, { recursive: true })) {
        const path = join(launchRoot, entry)
        if (!(await stat(path)).isFile()) {
          continue
        }
        await writeFile(path, (await readFile(path, 'utf8')).replace(/\r?\n/g, '\r\n'))
      }

      // Every file is rewritten, so the first mismatch is whichever plugin sorts
      // first — don't pin a name a later branch can reorder.
      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        /packaged bytes do not match /
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})
