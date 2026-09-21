import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hasInstructionalPluginContributions } from './plugin-consent-fingerprint'
import { pluginManifestSchema } from './plugin-manifest'
import { isSecretPluginSetting } from './plugin-settings-contribution'

describe.each(['hello-orca', 'worklog'])('%s plugin fixture', (name) => {
  it('uses an ESM entry that remains loadable outside a type-module package', async () => {
    const root = join(process.cwd(), 'examples', 'plugins', name)
    const manifest = pluginManifestSchema.parse(
      JSON.parse(await readFile(join(root, 'orca-plugin.json'), 'utf8'))
    )

    expect(manifest.main).toBe('main.mjs')
    const workerModule = (await import(pathToFileURL(join(root, manifest.main!)).href)) as {
      default?: unknown
    }
    expect(workerModule.default).toBeTypeOf('function')
  })
})

describe('worklog plugin fixture', () => {
  it('declares every surface the plugin guide documents', async () => {
    const root = join(process.cwd(), 'examples', 'plugins', 'worklog')
    const manifest = pluginManifestSchema.parse(
      JSON.parse(await readFile(join(root, 'orca-plugin.json'), 'utf8'))
    )

    // Why each one: the guide points at this example for that exact surface, so
    // dropping one here would leave the documentation citing nothing.
    expect(manifest.contributes.panels[0]?.surface).toBe('settings')
    expect(manifest.contributes.settings.some(isSecretPluginSetting)).toBe(true)
    expect(manifest.contributes.automations).toHaveLength(1)
    expect(manifest.contributes.events).not.toHaveLength(0)
    // An automation is instructional content, so consent binds to the tree hash.
    expect(hasInstructionalPluginContributions(manifest)).toBe(true)
  })
})
