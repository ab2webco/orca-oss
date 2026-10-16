import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePluginManifest } from '../../shared/plugins/plugin-manifest'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import { ORCHESTRATOR_GAME_SCENE_MAX_BYTES } from '../../shared/orchestrator-game-scene'
import type { DiscoveredPlugin } from './plugin-discovery'
import {
  collectPluginGameSceneContributions,
  readPluginGameSceneSources,
  setPluginGameSceneContributionProvider
} from './plugin-game-scene-sources'

const roots: string[] = []
afterEach(async () => {
  setPluginGameSceneContributionProvider(null)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-game-scene-sources-'))
  roots.push(root)
  return root
}

function plugin(pluginKey: string, rootDir: string, gameScenes: unknown[]): DiscoveredPlugin {
  const [publisher = '', id = ''] = pluginKey.split('.')
  const parsed = parsePluginManifest({
    manifestVersion: 1,
    id,
    publisher,
    name: id,
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { gameScenes }
  })
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return {
    pluginKey,
    rootDir,
    manifest: parsed.manifest,
    consentFingerprint: 'sha256-test',
    consentContentHash: 'hash',
    contentHash: 'hash',
    isDev: false
  }
}

describe('collectPluginGameSceneContributions', () => {
  it('serves scenes only from plugins the host currently runs as approved', () => {
    const plugins: DiscoveredPlugin[] = [
      plugin('acme.space', '/plugins/acme.space', [{ id: 'orbit', path: 'orbit.json' }]),
      plugin('acme.pending', '/plugins/acme.pending', [{ id: 'nope', path: 'nope.json' }]),
      plugin('acme.none', '/plugins/acme.none', []),
      { pluginKey: 'broken.one', rootDir: '/plugins/broken', error: 'bad manifest', isDev: false }
    ]
    const granted: Record<string, readonly PluginCapabilityKind[] | null> = {
      'acme.space': [],
      'acme.pending': null,
      'acme.none': []
    }

    expect(
      collectPluginGameSceneContributions({
        getDiscovered: () => plugins,
        getGrantedCapabilities: (key) => granted[key] ?? null
      })
    ).toEqual([
      { pluginKey: 'acme.space', rootDir: '/plugins/acme.space', id: 'orbit', path: 'orbit.json' }
    ])
  })
})

describe('readPluginGameSceneSources', () => {
  it('reads each declared file and turns an unreadable one into an error source', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await mkdir(join(root, 'scenes'))
    await writeFile(join(root, 'scenes', 'orbit.json'), '{"ok":true}')
    await writeFile(join(outside, 'secret.json'), '{}')
    await symlink(join(outside, 'secret.json'), join(root, 'scenes', 'escape.json'))
    await writeFile(join(root, 'big.json'), 'x'.repeat(ORCHESTRATOR_GAME_SCENE_MAX_BYTES + 1))
    const at = (id: string, path: string) => ({ pluginKey: 'acme.space', rootDir: root, id, path })
    setPluginGameSceneContributionProvider(() => [
      at('orbit', 'scenes/orbit.json'),
      at('escape', 'scenes/escape.json'),
      at('big', 'big.json'),
      at('gone', 'gone.json')
    ])

    const sources = await readPluginGameSceneSources()

    expect(sources[0]).toEqual({ pluginId: 'acme.space', id: 'orbit', text: '{"ok":true}' })
    expect(sources.slice(1)).toEqual([
      { pluginId: 'acme.space', id: 'escape', error: 'resolves outside the plugin directory' },
      { pluginId: 'acme.space', id: 'big', error: expect.stringContaining('artifact limit') },
      { pluginId: 'acme.space', id: 'gone', error: 'ENOENT' }
    ])
  })

  it('reads nothing before the composition root injects the plugin service', async () => {
    await expect(readPluginGameSceneSources()).resolves.toEqual([])
  })
})
