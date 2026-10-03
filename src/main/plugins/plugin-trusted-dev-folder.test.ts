import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverPlugins,
  isInvalidDiscoveredPlugin,
  type ValidDiscoveredPlugin
} from './plugin-discovery'
import { verifyInstructionalPluginContent } from './plugin-instructional-content-integrity'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-trusted-dev-'))
  roots.push(root)
  return root
}

function skillManifest(capabilities: { kind: string }[] = [{ kind: 'skills:contribute' }]) {
  return {
    manifestVersion: 1,
    id: 'whatsapp',
    publisher: 'acme',
    name: 'WhatsApp',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'worker.js',
    contributes: { skills: [{ path: 'skills/send' }] },
    capabilities
  }
}

async function skillPlugin(root: string): Promise<void> {
  await mkdir(join(root, 'skills', 'send'), { recursive: true })
  await writeFile(join(root, 'skills', 'send', 'SKILL.md'), '---\nname: send\n---\n')
  await writeFile(join(root, 'worker.js'), 'export default async function () {}')
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(skillManifest()))
}

async function discoverOne(options: {
  pluginsDir?: string
  devPluginPaths?: string[]
  trustedDevPluginPaths?: string[]
}): Promise<ValidDiscoveredPlugin> {
  const [plugin] = await discoverPlugins({
    pluginsDir: options.pluginsDir ?? (await tempDir()),
    devPluginPaths: options.devPluginPaths ?? [],
    trustedDevPluginPaths: options.trustedDevPluginPaths ?? [],
    hostVersion: '1.4.0'
  })
  if (!plugin || isInvalidDiscoveredPlugin(plugin)) {
    throw new Error(`expected a valid plugin, got ${JSON.stringify(plugin)}`)
  }
  return plugin
}

async function editContent(root: string): Promise<void> {
  await writeFile(join(root, 'skills', 'send', 'SKILL.md'), '---\nname: send\n---\nrm -rf\n')
  await writeFile(join(root, 'worker.js'), 'export default async function () { return 2 }')
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

describe('trusted dev folder consent', () => {
  it('keeps consent when content in a trusted dev folder changes', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const options = { devPluginPaths: [root], trustedDevPluginPaths: [root] }

    const before = await discoverOne(options)
    await editContent(root)
    const after = await discoverOne(options)

    expect(after.trustedDevFolder).toBe(true)
    expect(after.consentFingerprint).toBe(before.consentFingerprint)
  })

  it('still changes consent when a trusted dev plugin changes capabilities', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const options = { devPluginPaths: [root], trustedDevPluginPaths: [root] }

    const before = await discoverOne(options)
    await writeFile(
      join(root, 'orca-plugin.json'),
      JSON.stringify(skillManifest([{ kind: 'skills:contribute' }, { kind: 'storage' }]))
    )
    const after = await discoverOne(options)

    expect(after.consentFingerprint).not.toBe(before.consentFingerprint)
  })

  it('keeps binding an untrusted dev folder to its tree', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const options = { devPluginPaths: [root], trustedDevPluginPaths: [] }

    const before = await discoverOne(options)
    await editContent(root)
    const after = await discoverOne(options)

    expect(after.trustedDevFolder).toBe(false)
    expect(after.consentFingerprint).not.toBe(before.consentFingerprint)
  })

  it('asks for consent again when a folder becomes trusted', async () => {
    const root = await tempDir()
    await skillPlugin(root)

    const untrusted = await discoverOne({ devPluginPaths: [root] })
    const trusted = await discoverOne({ devPluginPaths: [root], trustedDevPluginPaths: [root] })

    expect(trusted.consentFingerprint).not.toBe(untrusted.consentFingerprint)
  })

  it('ignores trust for an installed plugin', async () => {
    const pluginsDir = await tempDir()
    const hash = 'a'.repeat(64)
    const versionDir = join(pluginsDir, 'acme.whatsapp', hash)
    await mkdir(versionDir, { recursive: true })
    await writeFile(join(pluginsDir, 'acme.whatsapp', 'current'), hash)
    await skillPlugin(versionDir)

    const plugin = await discoverOne({ pluginsDir, trustedDevPluginPaths: [versionDir] })

    expect(plugin.trustedDevFolder).toBe(false)
    expect(plugin.consentContentHash).toBe(hash)
  })
})

describe('trusted dev folder instructional reads', () => {
  it('serves edited instructional content from a trusted dev folder', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const plugin = await discoverOne({ devPluginPaths: [root], trustedDevPluginPaths: [root] })

    await editContent(root)

    await expect(verifyInstructionalPluginContent(plugin)).resolves.toBeUndefined()
  })

  it('rejects edited instructional content from an untrusted dev folder', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const plugin = await discoverOne({ devPluginPaths: [root] })

    await editContent(root)

    await expect(verifyInstructionalPluginContent(plugin)).rejects.toThrow(
      'changed since it was reviewed'
    )
  })
})
