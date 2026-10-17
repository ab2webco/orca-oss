import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOrchestratorGameConfig } from '../../shared/orchestrator-game-config'
import {
  buildOrchestratorGameLaunch,
  orchestratorGameLocaleOf,
  resolveOrchestratorGamePluginDir,
  orchestratorGameCliPathOf,
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
      locale: 'es'
    })

    expect(launch.args).toEqual(['--plugin-dir', PLUGIN_DIR])
    expect(launch.env).toEqual({
      ORCA_GAME_CLI: '/app/bin/orca',
      ORCA_GAME_MODE: 'zen',
      ORCA_GAME_SCENE: 'quest',
      ORCA_GAME_HUD: '1',
      ORCA_GAME_REWARDS: '0',
      ORCA_GAME_RENDER: 'classic',
      // Why the desktop's zone: an SSH pane's mod would otherwise read the host's clock.
      ORCA_GAME_TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ORCA_GAME_LOCALE: 'es',
      CLAUDE_CODE_NO_FLICKER: '1'
    })
  })

  it('hands the game its render and the timezone its day and night follow', () => {
    const launch = buildOrchestratorGameLaunch({
      resolved: resolveOrchestratorGameConfig({
        project: { render: 'hd', timezone: 'America/Bogota' }
      }),
      claudeVersion: '2.1.301',
      pluginDir: PLUGIN_DIR
    })

    expect(launch.env).toMatchObject({
      ORCA_GAME_RENDER: 'hd',
      ORCA_GAME_TIMEZONE: 'America/Bogota'
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
    ['es', 'en-US', 'es'],
    ['en', 'es-ES', 'en'],
    ['system', 'es_CO', 'es'],
    // Why: Orca Lab ships English and Spanish only, so these systems get English (ORCA-596).
    ['system', 'zh-CN', 'en'],
    ['system', 'ko-KR', 'en'],
    ['system', 'ja-JP', 'en'],
    ['system', 'fr-FR', 'en'],
    ['plugin:acme.lang/es-MX', 'en-US', 'es'],
    ['plugin:acme.lang/ja', 'es-ES', 'en'],
    [undefined, 'es-ES', 'es']
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

describe('orchestratorGameCliPathOf', () => {
  // Why: the skills run "$ORCA_GAME_CLI" in Git Bash, which runs a word with a slash as a path.
  it('hands Windows panes the CLI with forward slashes', () => {
    expect(
      orchestratorGameCliPathOf('C:\\Program Files\\Orca\\resources\\bin\\orca.exe', 'win32')
    ).toBe('C:/Program Files/Orca/resources/bin/orca.exe')
  })

  it('leaves POSIX paths and a missing CLI alone', () => {
    expect(orchestratorGameCliPathOf('/opt/orca a\\b', 'linux')).toBe('/opt/orca a\\b')
    expect(orchestratorGameCliPathOf(null, 'win32')).toBeNull()
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

  // Why each character: spaces split, `&` chains, `^` escapes, `%` expands in cmd even inside
  // quotes, `!` is delayed expansion, parentheses group, `'` closes a literal, unicode is a name.
  const hostile = "C:\\Users\\Zoë (dev)\\a & b ^c %PATH% !x! it's\\orca-game"
  const game = { args: ['--plugin-dir', hostile], env: {} }

  it('quotes the plugin dir for PowerShell 5 and 7 as a verbatim literal', () => {
    expect(withOrchestratorGameArgs('claude --teammate-mode in-process', game, 'powershell')).toBe(
      "claude '--plugin-dir' 'C:\\Users\\Zoë (dev)\\a & b ^c %PATH% !x! it''s\\orca-game' --teammate-mode in-process"
    )
  })

  it('quotes the plugin dir for cmd.exe, stepping out of the quotes only to escape percent', () => {
    expect(withOrchestratorGameArgs('claude --teammate-mode in-process', game, 'cmd')).toBe(
      'claude "--plugin-dir" "C:\\Users\\Zoë (dev)\\a & b ^c "^%"PATH"^%" !x! it\'s\\orca-game" --teammate-mode in-process'
    )
  })

  it('quotes a backslash plugin dir for Git Bash as one POSIX word', () => {
    expect(withOrchestratorGameArgs('claude', game, 'posix')).toBe(
      "claude '--plugin-dir' 'C:\\Users\\Zoë (dev)\\a & b ^c %PATH% !x! it'\\''s\\orca-game'"
    )
  })
})
