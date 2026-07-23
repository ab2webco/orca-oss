import { describe, expect, it } from 'vitest'
import { parseEnabledPluginInstalls, parsePluginHookEntries } from './global-config-sync'

describe('parseEnabledPluginInstalls', () => {
  const installedPlugins = JSON.stringify({
    plugins: {
      'engram@engram': [
        { scope: 'user', installPath: '/home/u/.claude/plugins/cache/engram/0.1.0' }
      ],
      'disabled@mk': [{ scope: 'user', installPath: '/home/u/.claude/plugins/cache/disabled' }],
      'proj@mk': [
        { scope: 'project', installPath: '/repo/.claude/plugins/proj', projectPath: '/repo' }
      ]
    }
  })
  const settings = JSON.stringify({
    enabledPlugins: { 'engram@engram': true, 'disabled@mk': false, 'proj@mk': true }
  })

  it('returns enabled user-scope installs with a display name', () => {
    expect(parseEnabledPluginInstalls(installedPlugins, [settings])).toEqual([
      {
        pluginId: 'engram@engram',
        pluginName: 'engram',
        installPath: '/home/u/.claude/plugins/cache/engram/0.1.0'
      }
    ])
  })

  it('ignores project-scope installs (hooks are user-scope) and disabled plugins', () => {
    const result = parseEnabledPluginInstalls(installedPlugins, [settings])
    expect(result.map((install) => install.pluginId)).not.toContain('proj@mk')
    expect(result.map((install) => install.pluginId)).not.toContain('disabled@mk')
  })

  it('returns [] when metadata is missing or unparseable', () => {
    expect(parseEnabledPluginInstalls(null, [null])).toEqual([])
    expect(parseEnabledPluginInstalls('{ broken', ['{ broken'])).toEqual([])
  })
})

describe('parsePluginHookEntries', () => {
  const root = '/plugins/engram/0.1.0'
  const hooksJson = JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|clear',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh',
              timeout: 10
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/scripts/session-stop.sh',
              timeout: 5,
              async: true
            }
          ]
        }
      ]
    }
  })

  it('expands ${CLAUDE_PLUGIN_ROOT} and captures matcher/timeout/async', () => {
    const entries = parsePluginHookEntries('engram', root, hooksJson)
    expect(entries).toEqual([
      {
        id: 'engram:SessionStart:startup|clear:session-start',
        pluginName: 'engram',
        event: 'SessionStart',
        matcher: 'startup|clear',
        command: '/plugins/engram/0.1.0/scripts/session-start.sh',
        timeout: 10
      },
      {
        id: 'engram:Stop::session-stop',
        pluginName: 'engram',
        event: 'Stop',
        command: '/plugins/engram/0.1.0/scripts/session-stop.sh',
        timeout: 5,
        async: true
      }
    ])
  })

  it('accepts a bare { Event: [...] } map without the hooks wrapper', () => {
    const bare = JSON.stringify({
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/x.sh' }] }]
    })
    const entries = parsePluginHookEntries('p', '/root', bare)
    expect(entries).toHaveLength(1)
    expect(entries[0].command).toBe('/root/x.sh')
    expect(entries[0].event).toBe('UserPromptSubmit')
  })

  it('returns [] for null or unparseable hooks.json', () => {
    expect(parsePluginHookEntries('p', '/root', null)).toEqual([])
    expect(parsePluginHookEntries('p', '/root', '{ broken')).toEqual([])
  })
})
