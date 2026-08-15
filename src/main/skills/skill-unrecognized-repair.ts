import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, realpath, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory,
  SkillRepairPreview,
  SkillRepairResult
} from '../../shared/skill-freshness'
import {
  isOwnerManagedSkillScope,
  SUPPORTED_GLOBAL_SKILL_TOPOLOGIES
} from '../../shared/skill-freshness'
import { buildAgentFeatureSkillInstallArgs } from '../../shared/agent-feature-install-commands'
import { resolveCliCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import { loadSkillBundleArtifacts } from './skill-bundle-artifacts'
import {
  canonicalSkillPath,
  collisionSafeBackupPath,
  linkProviderAliasToCanonical,
  pendingCanonicalCopy,
  restoreBackup
} from './skill-repair-backup'
import { normalizedSkillIdentityPath } from './skill-installation-topology'
import { observeSkillPackage } from './skill-package-identity'

type InstallerResult = { code: number; output: string }

type RepairDeps = {
  scan: () => Promise<SkillFreshnessInventory>
  readInstalledSkill?: (installation: SkillFreshnessInstallation) => Promise<string>
  readOfficialSkill?: (name: string) => Promise<string>
  runInstaller?: (name: string, agents: readonly string[]) => Promise<InstallerResult>
  now?: () => number
  randomId?: () => string
  homeDir?: () => string
}

type RepairRequest = {
  placementId: string
  expectedObservedPackageDigest: string
}

function repairablePlacement(
  inventory: SkillFreshnessInventory,
  placementId: string
): SkillFreshnessInstallation | null {
  const installation = inventory.installations.find((entry) => entry.id === placementId)
  if (
    !installation ||
    installation.sourceKind !== 'home' ||
    installation.status !== 'unrecognized' ||
    isOwnerManagedSkillScope(installation.topology) ||
    installation.topology !== 'independent-copy' ||
    !installation.resolvedPath ||
    !installation.observedPackageDigest
  ) {
    return null
  }
  return installation
}

// Why: 'current' is the state the repair is judged by, but the installer fetches repo
// HEAD, which legitimately runs ahead of the revision this build bundles — rejecting
// that would roll a correct install back to the copy the user asked us to replace.
// 'outdated' stays out: a managed copy behind the bundle is not what the button promised.
function isRepairedStatus(installation: SkillFreshnessInstallation): boolean {
  return installation.status === 'current' || installation.status === 'newer-known'
}

// Roots whose copy is the user's to replace. Named rather than derived so a root added
// to discovery cannot silently start accepting repairs before anyone judged its layout.
const REPAIRABLE_HOME_ROOT_IDS: ReadonlySet<string> = new Set([
  'home-claude',
  'home-codex',
  'home-grok',
  'home-opencode',
  'home-pi',
  'home-omp',
  'home-prime-agent',
  'home-gemini',
  'home-antigravity',
  'home-cursor',
  'home-agents'
])

// Why 'universal' and not the provider's own key: measured against the real CLI, an
// `--agent claude-code` install copies a second real directory into the provider home
// even when `~/.agents/skills/<name>` already holds the same skill — the layout that
// made this copy unrecognized in the first place, and that the global update cannot
// converge. 'universal' is the only target that writes the canonical copy; the provider
// alias pointing at it is ours to create.
const CANONICAL_INSTALL_AGENT = 'universal'

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function buildSkillRepairDiff(
  installed: string,
  official: string
): {
  addedLines: number
  removedLines: number
  diff: string
} {
  const before = splitLines(installed)
  const after = splitLines(official)
  const exclusiveLines = (source: readonly string[], target: readonly string[]): string[] => {
    const remaining = new Map<string, number>()
    for (const line of target) {
      remaining.set(line, (remaining.get(line) ?? 0) + 1)
    }
    return source.filter((line) => {
      const matches = remaining.get(line) ?? 0
      if (matches === 0) {
        return true
      }
      remaining.set(line, matches - 1)
      return false
    })
  }
  const removed = exclusiveLines(before, after)
  const added = exclusiveLines(after, before)
  return {
    addedLines: added.length,
    removedLines: removed.length,
    diff: [
      '--- installed/SKILL.md',
      '+++ official/SKILL.md',
      ...removed.map((line) => `-${line}`),
      ...added.map((line) => `+${line}`)
    ].join('\n')
  }
}

async function defaultOfficialSkill(name: string): Promise<string> {
  const content = (await loadSkillBundleArtifacts()).currentContent[name]
  if (content === undefined) {
    throw new Error(`Official skill content is unavailable: ${name}`)
  }
  return `### SKILL.md\n${content}`
}

async function defaultInstalledSkill(installation: SkillFreshnessInstallation): Promise<string> {
  const root = installation.resolvedPath!
  const observed = await observeSkillPackage(root)
  const sections = await Promise.all(
    observed.files.map(async (file) => {
      const body =
        file.classification === 'text'
          ? await readFile(join(root, ...file.path.split('/')), 'utf8')
          : '[binary file]'
      return `### ${file.path}\n${body}`
    })
  )
  return sections.join('\n')
}

async function defaultInstaller(name: string, agents: readonly string[]): Promise<InstallerResult> {
  const command = resolveCliCommand('npx')
  const args = buildSkillRepairInstallArgs(name, agents)
  const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(command, args)
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(spawnCmd, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.once('error', (error) => resolve({ code: 1, output: error.message }))
    child.once('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

export function buildSkillRepairInstallArgs(name: string, agents: readonly string[]): string[] {
  return [
    '--yes',
    ...buildAgentFeatureSkillInstallArgs([name], { global: true, yes: true, agents })
  ]
}

export class SkillUnrecognizedRepair {
  constructor(private readonly deps: RepairDeps) {}

  async preview(placementId: string): Promise<SkillRepairPreview> {
    const installation = repairablePlacement(await this.deps.scan(), placementId)
    if (!installation) {
      throw new Error('This skill copy is not repairable')
    }
    const [installed, official] = await Promise.all([
      this.deps.readInstalledSkill?.(installation) ?? defaultInstalledSkill(installation),
      this.deps.readOfficialSkill?.(installation.name) ?? defaultOfficialSkill(installation.name)
    ])
    return {
      placementId: installation.id,
      name: installation.name,
      expectedObservedPackageDigest: installation.observedPackageDigest!,
      ...buildSkillRepairDiff(installed, official)
    }
  }

  async repair(request: RepairRequest): Promise<SkillRepairResult> {
    const installation = repairablePlacement(await this.deps.scan(), request.placementId)
    if (!installation) {
      return {
        repaired: false,
        reason: 'not-repairable',
        message: 'This copy is no longer repairable.'
      }
    }
    if (installation.observedPackageDigest !== request.expectedObservedPackageDigest) {
      return {
        repaired: false,
        reason: 'copy-changed',
        message: 'The copy changed after the preview. Review it again.'
      }
    }
    if (!REPAIRABLE_HOME_ROOT_IDS.has(installation.rootId)) {
      return {
        repaired: false,
        reason: 'not-repairable',
        message: `Unsupported repair location: ${installation.rootId}`
      }
    }
    const home = (this.deps.homeDir ?? homedir)()
    const targetPath = installation.unresolvedPath
    const orphanCanonicalPath = await pendingCanonicalCopy(home, installation.name)
    const backupPath = await collisionSafeBackupPath(
      home,
      targetPath,
      (this.deps.now ?? Date.now)(),
      this.deps.randomId ?? (() => randomBytes(4).toString('hex'))
    )
    await rename(targetPath, backupPath)
    let installed: InstallerResult
    try {
      installed = await (this.deps.runInstaller ?? defaultInstaller)(installation.name, [
        CANONICAL_INSTALL_AGENT
      ])
    } catch (error) {
      await restoreBackup(targetPath, backupPath, orphanCanonicalPath)
      return {
        repaired: false,
        reason: 'install-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    if (installed.code !== 0) {
      await restoreBackup(targetPath, backupPath, orphanCanonicalPath)
      return { repaired: false, reason: 'install-failed', message: installed.output }
    }
    const canonicalPath = canonicalSkillPath(home, installation.name)
    if (normalizedSkillIdentityPath(canonicalPath) !== normalizedSkillIdentityPath(targetPath)) {
      try {
        await linkProviderAliasToCanonical(targetPath, canonicalPath)
      } catch (error) {
        await restoreBackup(targetPath, backupPath, orphanCanonicalPath)
        return {
          repaired: false,
          reason: 'install-failed',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
    let inventory: SkillFreshnessInventory
    try {
      inventory = await this.deps.scan()
    } catch (error) {
      await restoreBackup(targetPath, backupPath, orphanCanonicalPath)
      return {
        repaired: false,
        reason: 'did-not-converge',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    // Judged at the path we emptied, never by skill name: a healthy canonical copy
    // elsewhere is the normal state before a repair, so a name match reports success for
    // an installer that left this location empty or wrote another real directory — the
    // same unrecognized copy again on the next release.
    //
    // Matched through what the path resolves to rather than the path itself: an alias and
    // its canonical target share an inode, so the scan dedupes them into the canonical
    // row and no installation carries the provider path once the repair works.
    const repairedTarget = await realpath(targetPath).catch(() => null)
    const repaired =
      repairedTarget === null
        ? undefined
        : inventory.installations.find(
            (entry) =>
              entry.resolvedPath !== null &&
              normalizedSkillIdentityPath(entry.resolvedPath) ===
                normalizedSkillIdentityPath(repairedTarget) &&
              entry.name === installation.name &&
              isRepairedStatus(entry) &&
              SUPPORTED_GLOBAL_SKILL_TOPOLOGIES.has(entry.topology)
          )
    if (!repaired) {
      await restoreBackup(targetPath, backupPath, orphanCanonicalPath)
      return {
        repaired: false,
        reason: 'did-not-converge',
        message: 'The installer finished, but this location is not an up-to-date copy.'
      }
    }
    return { repaired: true, name: installation.name, backupPath, inventory }
  }
}
