import { describe, expect, it } from 'vitest'
import {
  PLUGIN_COMMAND_LIMIT,
  PLUGIN_ID_MAX_LENGTH,
  parsePluginManifest,
  pluginManifestSchema
} from './plugin-manifest'

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: 'demo',
    publisher: 'orca-samples',
    name: 'Demo',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { panels: [], commands: [], events: [] },
    capabilities: [],
    ...overrides
  }
}

describe('pluginManifestSchema boundaries', () => {
  it('accepts scoped network access and rejects invalid host scopes', () => {
    expect(
      parsePluginManifest(
        manifest({
          main: 'worker.js',
          capabilities: [{ kind: 'net:fetch', hosts: ['api.example.com', '*.hooks.example.com'] }]
        })
      ).ok
    ).toBe(true)
    expect(
      parsePluginManifest(
        manifest({ main: 'worker.js', capabilities: [{ kind: 'net:fetch', hosts: [] }] })
      ).ok
    ).toBe(false)
    expect(
      parsePluginManifest(
        manifest({
          main: 'worker.js',
          capabilities: [{ kind: 'net:fetch', hosts: ['https://api.example.com'] }]
        })
      ).ok
    ).toBe(false)
  })

  it('accepts documented dotted command namespaces with camel-case actions', () => {
    const result = parsePluginManifest(
      manifest({
        main: 'main.mjs',
        contributes: {
          panels: [],
          commands: [{ id: 'jupyter.restartKernel', title: 'Restart kernel' }],
          events: []
        }
      })
    )

    expect(result).toMatchObject({ ok: true })
  })

  it('rejects oversized identities and invalid semantic versions', () => {
    expect(parsePluginManifest(manifest({ id: 'a'.repeat(PLUGIN_ID_MAX_LENGTH + 1) })).ok).toBe(
      false
    )
    expect(parsePluginManifest(manifest({ version: '01.0.0' })).ok).toBe(false)
    expect(parsePluginManifest(manifest({ version: '1.0' })).ok).toBe(false)
    expect(parsePluginManifest(manifest({ version: '1.0.0-01' })).ok).toBe(false)
    expect(parsePluginManifest(manifest({ version: '1.0.0-alpha.1+build.5' })).ok).toBe(true)
  })

  it('defaults a panel surface to worktree and accepts the explicit settings and nav surfaces', () => {
    const parsed = pluginManifestSchema.safeParse(
      manifest({
        contributes: {
          panels: [
            { id: 'dashboard', title: 'Dashboard', entry: 'dashboard.html' },
            { id: 'registry', title: 'Registry', entry: 'registry.html', surface: 'settings' },
            { id: 'inbox', title: 'Inbox', entry: 'inbox.html', surface: 'nav' }
          ],
          commands: [],
          events: []
        }
      })
    )

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.contributes.panels.map((panel) => panel.surface)).toEqual([
        'worktree',
        'settings',
        'nav'
      ])
    }
  })

  it('rejects an unknown panel surface', () => {
    expect(
      parsePluginManifest(
        manifest({
          contributes: {
            panels: [{ id: 'registry', title: 'Registry', entry: 'r.html', surface: 'sidebar' }],
            commands: [],
            events: []
          }
        })
      ).ok
    ).toBe(false)
  })

  it('rejects duplicate contribution ids', () => {
    const parsed = pluginManifestSchema.safeParse(
      manifest({
        main: 'main.mjs',
        contributes: {
          panels: [
            { id: 'dashboard', title: 'One', entry: 'one.html' },
            { id: 'dashboard', title: 'Two', entry: 'two.html' }
          ],
          commands: [
            { id: 'run', title: 'One' },
            { id: 'run', title: 'Two' }
          ],
          events: []
        }
      })
    )

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining(['duplicate panels id: dashboard', 'duplicate commands id: run'])
      )
    }
  })

  it('caps contribution arrays before they reach renderer or worker registries', () => {
    const commands = Array.from({ length: PLUGIN_COMMAND_LIMIT + 1 }, (_, index) => ({
      id: `command-${index}`,
      title: `Command ${index}`
    }))
    expect(
      parsePluginManifest(
        manifest({
          main: 'main.mjs',
          contributes: { panels: [], commands, events: [] }
        })
      ).ok
    ).toBe(false)
  })
})

describe('contributes.automations', () => {
  const automation = {
    id: 'triage',
    title: 'WhatsApp: triage',
    trigger: '*/5 8-18 * * 1-5',
    timezone: 'America/Bogota',
    precheck: 'wa-scope pending',
    prompt: 'PROMPT-triage.md',
    provider: 'claude'
  }

  function withAutomations(entries: readonly Record<string, unknown>[]): Record<string, unknown> {
    return manifest({ contributes: { automations: entries } })
  }

  it('accepts a cron-triggered declaration and defaults to none', () => {
    expect(parsePluginManifest(withAutomations([automation])).ok).toBe(true)
    const parsed = pluginManifestSchema.parse(manifest())
    expect(parsed.contributes.automations).toEqual([])
  })

  it.each([
    ['an unparseable cron expression', { trigger: 'every five minutes' }],
    ['a cron expression that can never run', { trigger: '0 0 30 2 *' }],
    ['an RRULE where a cron expression belongs', { trigger: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' }],
    ['an unknown time zone', { timezone: 'Mars/Olympus' }],
    ['an agent Orca cannot launch', { provider: 'not-an-agent' }],
    ['a prompt that escapes the plugin directory', { prompt: '../../secrets.md' }],
    ['an absolute prompt path', { prompt: '/etc/passwd' }],
    ['an inline prompt instead of a file', { prompt: 'Triage the pending threads.\nThen stop.' }],
    ['an unknown extra key', { reuseSession: true }]
  ])('rejects %s', (_label, overrides) => {
    expect(parsePluginManifest(withAutomations([{ ...automation, ...overrides }])).ok).toBe(false)
  })

  it('rejects two declarations sharing one id', () => {
    expect(
      parsePluginManifest(withAutomations([automation, { ...automation, title: 'Other' }])).ok
    ).toBe(false)
  })
})
