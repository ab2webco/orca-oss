import { basename } from 'node:path'
import { stripUnsafeDisplayCharacters } from '../../shared/skill-display-text'
import { summarizeSkillMarkdown } from '../../shared/skill-metadata'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import {
  PLUGIN_SKILL_FILE_NAME,
  PLUGIN_SKILL_MARKDOWN_MAX_BYTES,
  readContainedPluginArtifactText,
  resolveContainedPluginDirectory
} from '../plugins/plugin-artifact-validation'
import { isInvalidDiscoveredPlugin, type DiscoveredPlugin } from '../plugins/plugin-discovery'
import { stablePathId, type SkillScanRoot } from './skill-discovery-sources'

/**
 * Skills an installed Orca plugin contributes to every agent, in every
 * workspace. The Claude equivalent (`claude-plugin-skill-sources.ts`) reads
 * another app's metadata off disk; here the authority is in-process, so the
 * composition root injects it the way `rpc/methods/plugins.ts` injects the
 * plugin service instead of widening every layer in between.
 *
 * Nothing here decides whether a plugin is trusted. `getGrantedCapabilities`
 * is the single chokepoint: it returns null unless the plugin is enabled,
 * consented at its current fingerprint, not kill-listed, and free of
 * activation errors. Uninstalling drops it from discovery entirely.
 */

export type OrcaPluginSkillContribution = {
  pluginKey: string
  pluginName: string
  /** Immutable install (or dev) tree the manifest was read from. */
  rootDir: string
  /** Manifest-declared directory, relative to `rootDir`, holding `SKILL.md`. */
  directory: string
}

/** Structural view of `PluginService` — keeps this unit testable without one. */
export type OrcaPluginSkillGrantSource = {
  getDiscovered: () => readonly DiscoveredPlugin[]
  getGrantedCapabilities: (pluginKey: string) => readonly PluginCapabilityKind[] | null
}

export const ORCA_PLUGIN_SKILL_CAPABILITY: PluginCapabilityKind = 'skills:contribute'

export function collectOrcaPluginSkillContributions(
  source: OrcaPluginSkillGrantSource
): OrcaPluginSkillContribution[] {
  const contributions: OrcaPluginSkillContribution[] = []
  for (const plugin of source.getDiscovered()) {
    if (isInvalidDiscoveredPlugin(plugin) || plugin.manifest.contributes.skills.length === 0) {
      continue
    }
    // Deny-by-default: an unconsented, disabled, stale, or revoked plugin
    // reads exactly like one that never declared a skill.
    if (!source.getGrantedCapabilities(plugin.pluginKey)?.includes(ORCA_PLUGIN_SKILL_CAPABILITY)) {
      continue
    }
    for (const skill of plugin.manifest.contributes.skills) {
      contributions.push({
        pluginKey: plugin.pluginKey,
        pluginName: plugin.manifest.name,
        rootDir: plugin.rootDir,
        directory: skill.path
      })
    }
  }
  return contributions.sort(
    (a, b) => a.pluginKey.localeCompare(b.pluginKey) || a.directory.localeCompare(b.directory)
  )
}

let contributionProvider: (() => readonly OrcaPluginSkillContribution[]) | null = null

/** Injected once at the composition root; null on shutdown and in tests. */
export function setOrcaPluginSkillContributionProvider(
  provider: (() => readonly OrcaPluginSkillContribution[]) | null
): void {
  contributionProvider = provider
}

export function listOrcaPluginSkillContributions(): readonly OrcaPluginSkillContribution[] {
  return contributionProvider?.() ?? []
}

/** Plugin name as a source label: attribution, so it must survive untrusted text. */
export function orcaPluginSkillSourceLabel(pluginName: string): string {
  return `Orca plugin ${stripUnsafeDisplayCharacters(pluginName).slice(0, 80) || 'plugin'}`
}

export async function resolveOrcaPluginSkillSources(
  contributions: readonly OrcaPluginSkillContribution[]
): Promise<SkillScanRoot[]> {
  const roots = new Map<string, SkillScanRoot>()
  await Promise.all(
    contributions.map(async (contribution) => {
      // Re-resolve rather than join: the manifest was validated when the plugin
      // was discovered, and this root is walked on every scan long after.
      const path = await resolveContainedPluginDirectory(
        contribution.rootDir,
        contribution.directory
      ).catch(() => null)
      if (!path || roots.has(path)) {
        return
      }
      roots.set(path, {
        id: `orca-plugin-${stablePathId(path)}`,
        label: orcaPluginSkillSourceLabel(contribution.pluginName),
        path,
        sourceKind: 'plugin',
        // Any agent, any project: that is the whole point of the capability.
        providers: ['claude', 'codex', 'agent-skills'],
        owner: null,
        // The declared directory *is* the skill, so the walk never descends:
        // one readdir per contribution, whatever the plugin ships beside it.
        maxDepth: 0
      })
    })
  )
  return [...roots.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export async function discoverOrcaPluginSkillSources(): Promise<SkillScanRoot[]> {
  return resolveOrcaPluginSkillSources(listOrcaPluginSkillContributions())
}

export type ServedOrcaPluginSkill = {
  name: string
  pluginKey: string
  pluginName: string
  sourceLabel: string
  markdown: string
}

async function readContribution(
  contribution: OrcaPluginSkillContribution
): Promise<ServedOrcaPluginSkill | null> {
  const markdown = await readContainedPluginArtifactText(
    contribution.rootDir,
    `${contribution.directory}/${PLUGIN_SKILL_FILE_NAME}`,
    PLUGIN_SKILL_MARKDOWN_MAX_BYTES
  ).catch(() => null)
  if (markdown === null) {
    return null
  }
  return {
    name: summarizeSkillMarkdown(markdown).name ?? basename(contribution.directory),
    pluginKey: contribution.pluginKey,
    pluginName: contribution.pluginName,
    sourceLabel: orcaPluginSkillSourceLabel(contribution.pluginName),
    markdown
  }
}

/** Backs `orca skills get <name>` for plugin-contributed skills. Reads are
 *  bounded by the declared contributions, each capped at the markdown limit. */
export async function readOrcaPluginSkill(
  name: string,
  contributions: readonly OrcaPluginSkillContribution[] = listOrcaPluginSkillContributions()
): Promise<ServedOrcaPluginSkill | null> {
  for (const contribution of contributions) {
    const served = await readContribution(contribution)
    if (served?.name === name) {
      return served
    }
  }
  return null
}
