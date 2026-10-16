import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import {
  buildOrchestratorGameLaunch,
  resolveOrchestratorGamePluginDir
} from './orchestrator-game-launch'

const PLUGIN_DIR = '/app/resources/claude-plugins/orca-game'

describe('buildOrchestratorGameLaunch', () => {
  it('loads the plugin with the effective config on a Claude Code that supports mods', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({ project: { mode: 'zen', rewards: false } }),
      claudeVersion: '2.1.301',
      pluginDir: PLUGIN_DIR
    })

    expect(launch.args).toEqual(['--plugin-dir', PLUGIN_DIR])
    expect(launch.env).toEqual({
      ORCA_GAME_MODE: 'zen',
      ORCA_GAME_SCENE: 'quest',
      ORCA_GAME_HUD: '1',
      ORCA_GAME_REWARDS: '0'
    })
  })

  it('accepts the first Claude Code version with mods', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({}),
      claudeVersion: '2.1.287',
      pluginDir: PLUGIN_DIR
    })

    expect(launch.args).toEqual(['--plugin-dir', PLUGIN_DIR])
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
