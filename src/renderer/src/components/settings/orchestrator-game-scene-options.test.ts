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

const BUILT_IN = ['quest', 'vigilante', 'jrpg', 'tamer'].map((scene) => ({
  value: scene,
  kind: 'built-in',
  scene
}))

describe('orchestratorGameSceneOptions', () => {
  it('lists the built-in scenes first, then the scenes of plugins the host runs', () => {
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
      ...BUILT_IN,
      { value: 'acme.space/moon', kind: 'plugin', scene: 'moon', pluginName: 'Space Pack' },
      { value: 'acme.space/orbit', kind: 'plugin', scene: 'orbit', pluginName: 'Space Pack' }
    ])
  })

  it('keeps a scene id nothing installed serves, so orca.yaml values still show as-is', () => {
    expect(orchestratorGameSceneOptions([], 'acme.gone/orbit')).toEqual([
      ...BUILT_IN,
      { value: 'acme.gone/orbit', kind: 'missing', scene: 'acme.gone/orbit' }
    ])
  })

  it('never marks a built-in scene as not installed', () => {
    const options = orchestratorGameSceneOptions([], 'tamer')
    expect(options).toEqual(BUILT_IN)
  })

  it("adds the project's scene files after the plugins, each once even when it is the current one", () => {
    const options = orchestratorGameSceneOptions([], 'file:.orca/scenes/mario.json', [
      '.orca/scenes/deep-space.json',
      '.orca/scenes/mario.json'
    ])
    expect(options).toEqual([
      ...BUILT_IN,
      {
        value: 'file:.orca/scenes/deep-space.json',
        kind: 'file',
        scene: 'file:.orca/scenes/deep-space.json',
        path: '.orca/scenes/deep-space.json'
      },
      {
        value: 'file:.orca/scenes/mario.json',
        kind: 'file',
        scene: 'file:.orca/scenes/mario.json',
        path: '.orca/scenes/mario.json'
      }
    ])
  })
})
