import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parsePluginManifest, type PluginManifest } from '../../shared/plugins/plugin-manifest'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import type { DiscoveredPlugin } from '../plugins/plugin-discovery'
import {
  collectOrcaPluginSkillContributions,
  readOrcaPluginSkill,
  resolveOrcaPluginSkillSources,
  setOrcaPluginSkillContributionProvider,
  type OrcaPluginSkillContribution
} from './orca-plugin-skill-sources'
import { clearSkillRootScanCache, discoverSkills } from './discovery'

const SKILL_MARKDOWN = `---
name: send-whatsapp
description: Send a WhatsApp message through the installed plugin.
---

Run \`wa send --to <number>\`.
`

function manifest(overrides: {
  skills?: { path: string }[]
  capabilities?: { kind: PluginCapabilityKind }[]
}): PluginManifest {
  const parsed = parsePluginManifest({
    manifestVersion: 1,
    id: 'whatsapp',
    publisher: 'acme',
    name: 'WhatsApp',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { skills: overrides.skills ?? [{ path: 'skills/send-whatsapp' }] },
    capabilities: overrides.capabilities ?? [{ kind: 'skills:contribute' }]
  })
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.manifest
}

function plugin(rootDir: string, pluginManifest: PluginManifest): DiscoveredPlugin {
  return {
    pluginKey: 'acme.whatsapp',
    rootDir,
    manifest: pluginManifest,
    consentFingerprint: 'sha256-test',
    consentContentHash: 'hash',
    contentHash: 'hash',
    isDev: false
  }
}

function grantSource(
  plugins: readonly DiscoveredPlugin[],
  granted: readonly PluginCapabilityKind[] | null
): Parameters<typeof collectOrcaPluginSkillContributions>[0] {
  return { getDiscovered: () => plugins, getGrantedCapabilities: () => granted }
}

describe('Orca plugin skill sources', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'orca-plugin-skills-'))
    await mkdir(join(rootDir, 'skills', 'send-whatsapp'), { recursive: true })
    await writeFile(join(rootDir, 'skills', 'send-whatsapp', 'SKILL.md'), SKILL_MARKDOWN)
    clearSkillRootScanCache()
  })

  afterEach(() => {
    setOrcaPluginSkillContributionProvider(null)
    clearSkillRootScanCache()
  })

  it('collects a consented plugin declaring the capability', () => {
    expect(
      collectOrcaPluginSkillContributions(
        grantSource([plugin(rootDir, manifest({}))], ['skills:contribute'])
      )
    ).toEqual([
      {
        pluginKey: 'acme.whatsapp',
        pluginName: 'WhatsApp',
        rootDir,
        directory: 'skills/send-whatsapp'
      }
    ])
  })

  it('collects nothing when the plugin is disabled, unconsented, or revoked', () => {
    // getGrantedCapabilities returns null for every one of those states.
    expect(
      collectOrcaPluginSkillContributions(grantSource([plugin(rootDir, manifest({}))], null))
    ).toEqual([])
  })

  it('collects nothing when the capability was not granted, even with skills declared', () => {
    expect(
      collectOrcaPluginSkillContributions(
        grantSource([plugin(rootDir, manifest({}))], ['workspace:read'])
      )
    ).toEqual([])
  })

  it('attributes each root to its plugin and never descends below the declared directory', async () => {
    const sources = await resolveOrcaPluginSkillSources(
      collectOrcaPluginSkillContributions(
        grantSource([plugin(rootDir, manifest({}))], ['skills:contribute'])
      )
    )

    expect(sources).toEqual([
      expect.objectContaining({
        label: 'Orca plugin WhatsApp',
        sourceKind: 'plugin',
        providers: ['claude', 'codex', 'agent-skills'],
        owner: null,
        maxDepth: 0
      })
    ])
  })

  it('rejects a declared directory that resolves outside the plugin root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'orca-plugin-outside-'))
    await mkdir(join(outside, 'skill'), { recursive: true })
    await writeFile(join(outside, 'skill', 'SKILL.md'), SKILL_MARKDOWN)
    await symlink(join(outside, 'skill'), join(rootDir, 'escape'))

    const contributions: OrcaPluginSkillContribution[] = [
      { pluginKey: 'acme.whatsapp', pluginName: 'WhatsApp', rootDir, directory: 'escape' }
    ]

    expect(await resolveOrcaPluginSkillSources(contributions)).toEqual([])
    expect(await readOrcaPluginSkill('send-whatsapp', contributions)).toBeNull()
  })

  it('serves the declared skill by name for `orca skills get`', async () => {
    const contributions = collectOrcaPluginSkillContributions(
      grantSource([plugin(rootDir, manifest({}))], ['skills:contribute'])
    )

    expect(await readOrcaPluginSkill('send-whatsapp', contributions)).toMatchObject({
      name: 'send-whatsapp',
      pluginKey: 'acme.whatsapp',
      sourceLabel: 'Orca plugin WhatsApp',
      markdown: SKILL_MARKDOWN
    })
    expect(await readOrcaPluginSkill('not-a-skill', contributions)).toBeNull()
  })

  it('surfaces the skill in workspace discovery, attributed to the plugin', async () => {
    setOrcaPluginSkillContributionProvider(() =>
      collectOrcaPluginSkillContributions(
        grantSource([plugin(rootDir, manifest({}))], ['skills:contribute'])
      )
    )
    const emptyHome = await mkdtemp(join(tmpdir(), 'orca-plugin-home-'))

    const result = await discoverSkills({ repos: [], homeDir: emptyHome, cwd: emptyHome })

    expect(result.skills).toEqual([
      expect.objectContaining({
        name: 'send-whatsapp',
        sourceKind: 'plugin',
        sourceLabel: 'Orca plugin WhatsApp'
      })
    ])
  })

  it('contributes nothing to discovery once the plugin is disabled or uninstalled', async () => {
    setOrcaPluginSkillContributionProvider(() => [])
    const emptyHome = await mkdtemp(join(tmpdir(), 'orca-plugin-home-'))

    const result = await discoverSkills({ repos: [], homeDir: emptyHome, cwd: emptyHome })

    expect(result.skills).toEqual([])
    expect(result.sources.some((source) => source.label.startsWith('Orca plugin'))).toBe(false)
  })
})
