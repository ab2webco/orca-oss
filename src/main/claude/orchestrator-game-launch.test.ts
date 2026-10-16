import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import {
  buildOrchestratorGameLaunch,
  orchestratorGameLocaleOf,
  resolveOrchestratorGamePluginDir,
  withOrchestratorGameArgs
} from './orchestrator-game-launch'

const PLUGIN_DIR = '/app/resources/claude-plugins/orca-game'

describe('buildOrchestratorGameLaunch', () => {
  it('loads the plugin with the effective config on a Claude Code that supports mods', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({ project: { mode: 'zen', rewards: false } }),
      claudeVersion: '2.1.301',
      pluginDir: PLUGIN_DIR,
      orcaCli: '/app/bin/orca',
      locale: 'ja'
    })

    expect(launch.args).toEqual(['--plugin-dir', PLUGIN_DIR])
    expect(launch.env).toEqual({
      ORCA_GAME_CLI: '/app/bin/orca',
      ORCA_GAME_MODE: 'zen',
      ORCA_GAME_SCENE: 'quest',
      ORCA_GAME_HUD: '1',
      ORCA_GAME_REWARDS: '0',
      ORCA_GAME_LOCALE: 'ja'
    })
  })

  it('tells the game English when no language is given', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({}),
      claudeVersion: '2.1.301',
      pluginDir: PLUGIN_DIR
    })

    expect(launch.env.ORCA_GAME_LOCALE).toBe('en')
  })

  it('accepts the first Claude Code version with mods', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({}),
      claudeVersion: '2.1.287',
      pluginDir: PLUGIN_DIR
    })

    expect(launch.args).toEqual(['--plugin-dir', PLUGIN_DIR])
  })

  // Why: the mod never runs a bare `orca`; without a path it still draws, just with no fleet data.
  it('loads the plugin without ORCA_GAME_CLI when no Orca CLI path resolves', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({}),
      claudeVersion: '2.1.301',
      pluginDir: PLUGIN_DIR,
      orcaCli: null
    })

    expect(launch.args).toEqual(['--plugin-dir', PLUGIN_DIR])
    expect(launch.env).not.toHaveProperty('ORCA_GAME_CLI')
  })

  it.each([
    ['the game is off', { global: { mode: 'off' as const } }, '2.1.301', PLUGIN_DIR],
    ['Claude Code is older than mods', {}, '2.1.286', PLUGIN_DIR],
    ['the Claude Code version is unknown', {}, null, PLUGIN_DIR],
    ['the plugin folder is missing', {}, '2.1.301', null]
  ])('launches plain Claude when %s', (_reason, layers, claudeVersion, pluginDir) => {
    expect(
      buildOrchestratorGameLaunch({
        resolved: resolveOrchestratorGameConfig(layers),
        claudeVersion,
        pluginDir
      })
    ).toEqual({ args: [], env: {} })
  })
})

describe('orchestratorGameLocaleOf', () => {
  it.each([
    ['es', 'ja-JP', 'es'],
    ['zh', 'en-US', 'zh'],
    ['system', 'ko-KR', 'ko'],
    ['system', 'es_CO', 'es'],
    // Why: Orca has no Traditional Chinese catalog, so the renderer shows English too.
    ['system', 'zh-TW', 'en'],
    ['system', 'fr-FR', 'en'],
    ['plugin:acme.lang/es-MX', 'en-US', 'es'],
    ['plugin:acme.lang/fr', 'ja-JP', 'en'],
    [undefined, 'ja-JP', 'ja']
  ] as const)('maps the UI language %s (system %s) to %s', (language, system, expected) => {
    expect(orchestratorGameLocaleOf(language, system)).toBe(expected)
  })
})

describe('resolveOrchestratorGamePluginDir', () => {
  it('points at the packaged resources or the dev checkout', () => {
    expect(
      resolveOrchestratorGamePluginDir({ isPackaged: true, resourcesPath: '/r', appPath: '/a' })
    ).toBe(join('/r', 'claude-plugins', 'orca-game'))
    expect(
      resolveOrchestratorGamePluginDir({ isPackaged: false, resourcesPath: '/r', appPath: '/a' })
    ).toBe(join('/a', 'resources', 'claude-plugins', 'orca-game'))
  })
})

describe('withOrchestratorGameArgs', () => {
  it('puts the quoted plugin args right after the Claude executable', () => {
    expect(
      withOrchestratorGameArgs("claude --teammate-mode auto 'hi'", {
        args: ['--plugin-dir', "/Apps/Orca Lab/it's/orca-game"],
        env: {}
      })
    ).toBe("claude '--plugin-dir' '/Apps/Orca Lab/it'\\''s/orca-game' --teammate-mode auto 'hi'")
  })

  it('leaves the command alone when the game does not load', () => {
    expect(withOrchestratorGameArgs('claude', { args: [], env: {} })).toBe('claude')
  })
})
