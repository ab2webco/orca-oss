import { describe, expect, it } from 'vitest'
import type { PluginHostListEntry } from '../../../../preload/api/plugin-host-api'
import { orchestratorGameSceneOptions } from './orchestrator-game-scene-options'

const plugin = (patch: Partial<PluginHostListEntry>): PluginHostListEntry => ({
  pluginKey: 'acme.space',
  consentFingerprint: 'sha256-x',
  name: 'Space Pack',
  version: '1.0.0',
  publisher: 'acme',
  status: 'idle',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  restarts: 0,
  ...patch
})

describe('orchestratorGameSceneOptions', () => {
  it('lists quest first, then the scenes of plugins the host runs', () => {
    const options = orchestratorGameSceneOptions(
      [
        plugin({ gameScenes: ['acme.space/orbit', 'acme.space/moon'] }),
        plugin({
          pluginKey: 'acme.off',
          name: 'Off',
          status: 'disabled',
          gameScenes: ['acme.off/a']
        }),
        plugin({
          pluginKey: 'acme.new',
          name: 'New',
          status: 'pending',
          gameScenes: ['acme.new/a']
        }),
        plugin({
          pluginKey: 'acme.bad',
          name: 'Bad',
          blockedByKillList: { reason: 'malware' },
          gameScenes: ['acme.bad/a']
        }),
        plugin({ pluginKey: 'acme.old', name: 'Old host' })
      ],
      'quest'
    )

    expect(options).toEqual([
      { value: 'quest', kind: 'built-in', scene: 'quest' },
      { value: 'acme.space/moon', kind: 'plugin', scene: 'moon', pluginName: 'Space Pack' },
      { value: 'acme.space/orbit', kind: 'plugin', scene: 'orbit', pluginName: 'Space Pack' }
    ])
  })

  it('keeps a scene id nothing installed serves, so orca.yaml values still show as-is', () => {
    expect(orchestratorGameSceneOptions([], 'acme.gone/orbit')).toEqual([
      { value: 'quest', kind: 'built-in', scene: 'quest' },
      { value: 'acme.gone/orbit', kind: 'missing', scene: 'acme.gone/orbit' }
    ])
  })
})
