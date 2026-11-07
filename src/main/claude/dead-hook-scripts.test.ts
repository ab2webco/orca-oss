import { describe, expect, it } from 'vitest'
import { findDeadHookScripts, pluginNameFromScriptPath } from './dead-hook-scripts'

const DEAD_GATE =
  '/tmp/orca-fresh-profile.abc/plugins/ab2web.orca-jev-advisor/e5c6/adapters/claude/gate-bash.ts'
const LIVE_HINT = '/Users/me/.claude/skills/orca-sonar/search-hint.mjs'

// The shape a deleted dev profile left behind on 2026-11-06 (ORCA-1113).
const SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: '/usr/local/bin/node',
            args: [DEAD_GATE],
            statusMessage: 'orca-jev-advisor: asking Jev before running this command'
          },
          { type: 'command', command: '/usr/local/bin/node', args: [LIVE_HINT, '/profile'] }
        ]
      },
      {
        hooks: [
          {
            type: 'command',
            command: 'if [ -f "$HOME/.orca/agent-hooks/claude-hook.sh" ]; then :; fi'
          }
        ]
      }
    ],
    Stop: [
      { hooks: [{ type: 'command', command: 'node "/gone/plugins/cache/mkt/memo/1.0/stop.mjs"' }] }
    ]
  }
}

const exists = (path: string): boolean => path === LIVE_HINT

describe('findDeadHookScripts', () => {
  it('names each hook whose script file is gone, with its plugin', () => {
    expect(findDeadHookScripts('/home/.claude/settings.json', SETTINGS, exists)).toEqual([
      {
        settingsPath: '/home/.claude/settings.json',
        event: 'PreToolUse',
        name: 'orca-jev-advisor: asking Jev before running this command',
        plugin: 'ab2web.orca-jev-advisor',
        scriptPath: DEAD_GATE
      },
      {
        settingsPath: '/home/.claude/settings.json',
        event: 'Stop',
        name: 'stop.mjs',
        plugin: 'memo',
        scriptPath: '/gone/plugins/cache/mkt/memo/1.0/stop.mjs'
      }
    ])
  })

  it('ignores binaries, data arguments and paths that resolve at run time', () => {
    expect(findDeadHookScripts('/s.json', SETTINGS, () => true)).toEqual([])
    const runtimeOnly = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs' }] }]
      }
    }
    expect(findDeadHookScripts('/s.json', runtimeOnly, () => false)).toEqual([])
  })

  it('reads a Windows script path', () => {
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ command: 'node.exe', args: ['C:\\Orca\\plugins\\x.y\\h\\stop.cjs'] }] }]
      }
    }
    expect(findDeadHookScripts('s', settings, () => false)).toMatchObject([
      { plugin: 'x.y', name: 'stop.cjs' }
    ])
  })

  it('returns nothing for settings without hooks or with a malformed shape', () => {
    expect(findDeadHookScripts('s', null, () => false)).toEqual([])
    expect(findDeadHookScripts('s', { hooks: { Stop: 'x' } }, () => false)).toEqual([])
  })
})

describe('pluginNameFromScriptPath', () => {
  it('reads Orca plugin, Claude plugin cache and skill folders', () => {
    expect(pluginNameFromScriptPath(DEAD_GATE)).toBe('ab2web.orca-jev-advisor')
    expect(pluginNameFromScriptPath('/h/.claude/plugins/cache/mkt/engram/2.1/a.mjs')).toBe('engram')
    expect(pluginNameFromScriptPath(LIVE_HINT)).toBe('orca-sonar')
    expect(pluginNameFromScriptPath('/opt/hooks/a.sh')).toBeNull()
  })
})
