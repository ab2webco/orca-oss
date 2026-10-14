import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PluginHookEntry } from '../../shared/global-config-sync'
import { collectGlobalHooks, mergeHooksIntoVaultSettings } from './plugin-hooks-inheritance'

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'orca-plugin-hooks-'))
}

describe('collectGlobalHooks', () => {
  it('resolves enabled-plugin hooks with ${CLAUDE_PLUGIN_ROOT} expanded', () => {
    const home = makeDir()
    const installPath = join(makeDir(), 'engram')
    mkdirSync(join(installPath, 'hooks'), { recursive: true })
    writeFileSync(
      join(installPath, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/s.sh', timeout: 10 }] }
          ]
        }
      })
    )
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'engram@engram': [{ scope: 'user', installPath }] } })
    )
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'engram@engram': true } })
    )
    const hooks = collectGlobalHooks(home)
    expect(hooks).toHaveLength(1)
    expect(hooks[0].command).toBe(join(installPath, 's.sh'))
    expect(hooks[0].event).toBe('SessionStart')
    expect(hooks[0].installPath).toBe(installPath)
  })

  it('returns [] when no plugins are installed', () => {
    expect(collectGlobalHooks(makeDir())).toEqual([])
  })
})

describe('mergeHooksIntoVaultSettings', () => {
  const hook: PluginHookEntry = {
    id: 'engram:Stop::session-stop',
    pluginName: 'engram',
    event: 'Stop',
    command: '/plugins/engram/session-stop.sh',
    timeout: 5,
    async: true
  }

  it('seeds hooks into an empty settings file', () => {
    const parsed = JSON.parse(mergeHooksIntoVaultSettings(null, [hook]) as string)
    expect(parsed.hooks.Stop).toEqual([
      {
        hooks: [
          { type: 'command', command: '/plugins/engram/session-stop.sh', timeout: 5, async: true }
        ]
      }
    ])
  })

  it('appends to an event array without clobbering existing (e.g. Orca Lab) hooks', () => {
    const existing = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/orca/claude-hook.sh' }] }] }
    })
    const parsed = JSON.parse(mergeHooksIntoVaultSettings(existing, [hook]) as string)
    expect(parsed.hooks.Stop).toHaveLength(2)
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe('/orca/claude-hook.sh')
    expect(parsed.hooks.Stop[1].hooks[0].command).toBe('/plugins/engram/session-stop.sh')
  })

  it('preserves unrelated settings keys (e.g. custom-endpoint env)', () => {
    const existing = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'secret' } })
    const parsed = JSON.parse(mergeHooksIntoVaultSettings(existing, [hook]) as string)
    expect(parsed.env).toEqual({ ANTHROPIC_AUTH_TOKEN: 'secret' })
    expect(parsed.hooks.Stop).toHaveLength(1)
  })

  it('is idempotent — returns null when the command is already present', () => {
    const existing = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/plugins/engram/session-stop.sh' }] }]
      }
    })
    expect(mergeHooksIntoVaultSettings(existing, [hook])).toBeNull()
  })

  describe('after a plugin update', () => {
    const cacheRoot = join('/home/u', '.claude', 'plugins', 'cache', 'engram', 'engram')
    const current: PluginHookEntry = {
      id: 'engram:SessionStart::session-start',
      pluginName: 'engram',
      installPath: join(cacheRoot, '0.1.12'),
      event: 'SessionStart',
      command: join(cacheRoot, '0.1.12', 'scripts', 'session-start.sh')
    }

    it('replaces hooks that point at an older version of the same plugin', () => {
      const existing = JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: join(cacheRoot, '0.1.0', 'scripts', 's.sh') }] },
            {
              hooks: [
                {
                  type: 'command',
                  command: `"${join(cacheRoot, '0.1.3', 'scripts', 'session-start.sh')}"`
                }
              ]
            },
            { hooks: [{ type: 'command', command: '/orca/claude-hook.sh' }] }
          ],
          SessionEnd: [
            { hooks: [{ type: 'command', command: join(cacheRoot, '0.1.3', 'scripts', 'e.sh') }] }
          ]
        }
      })
      const parsed = JSON.parse(mergeHooksIntoVaultSettings(existing, [current]) as string)
      expect(
        parsed.hooks.SessionStart.map((d: { hooks: { command: string }[] }) => d.hooks[0].command)
      ).toEqual(['/orca/claude-hook.sh', current.command])
      expect(parsed.hooks.SessionEnd).toBeUndefined()
    })

    it('leaves hooks alone for a plugin installed outside the plugin cache', () => {
      const local: PluginHookEntry = {
        ...current,
        installPath: join('/home/u', 'Projects', 'my-plugin'),
        command: join('/home/u', 'Projects', 'my-plugin', 'hook.sh')
      }
      const sibling = join('/home/u', 'Projects', 'other-tool', 'hook.sh')
      const existing = JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: sibling }] }] }
      })
      const parsed = JSON.parse(mergeHooksIntoVaultSettings(existing, [local]) as string)
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(sibling)
      expect(parsed.hooks.SessionStart).toHaveLength(2)
    })
  })

  it('returns null for empty hooks or unparseable settings (never clobbers)', () => {
    expect(mergeHooksIntoVaultSettings(null, [])).toBeNull()
    expect(mergeHooksIntoVaultSettings('{ broken', [hook])).toBeNull()
  })
})
