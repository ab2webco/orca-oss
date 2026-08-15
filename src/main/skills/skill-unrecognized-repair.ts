import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory,
  SkillRepairPreview,
  SkillRepairResult
} from '../../shared/skill-freshness'
import { isOwnerManagedSkillScope } from '../../shared/skill-freshness'
import { buildAgentFeatureSkillInstallArgs } from '../../shared/agent-feature-install-commands'
import { resolveCliCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import { loadSkillBundleArtifacts } from './skill-bundle-artifacts'
import { observeSkillPackage } from './skill-package-identity'

type InstallerResult = { code: number; output: string }

type RepairDeps = {
  scan: () => Promise<SkillFreshnessInventory>
  readInstalledSkill?: (installation: SkillFreshnessInstallation) => Promise<string>
  readOfficialSkill?: (name: string) => Promise<string>
  runInstaller?: (name: string, agents: readonly string[]) => Promise<InstallerResult>
  now?: () => number
  randomId?: () => string
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

function installAgents(installation: SkillFreshnessInstallation): string[] {
  const rootAgent = new Map<string, string>([
    ['home-claude', 'claude-code'],
    ['home-codex', 'codex'],
    ['home-grok', 'grok'],
    ['home-opencode', 'opencode'],
    ['home-pi', 'pi'],
    ['home-omp', 'omp'],
    ['home-prime-agent', 'prime-agent'],
    ['home-gemini', 'gemini'],
    ['home-antigravity', 'antigravity'],
    ['home-cursor', 'cursor'],
    ['home-agents', 'universal']
  ])
  const agent = rootAgent.get(installation.rootId)
  if (!agent) {
    throw new Error(`Unsupported repair location: ${installation.rootId}`)
  }
  return [agent]
}

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

async function collisionSafeBackupPath(
  targetPath: string,
  now: number,
  randomId: () => string
): Promise<string> {
  const home = dirname(dirname(dirname(targetPath)))
  const parent = join(home, '.orca', 'skill-backups')
  const name = basename(targetPath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = join(parent, `${name}-${now}-${randomId()}`)
    try {
      await lstat(candidate)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return candidate
      }
      throw error
    }
  }
  throw new Error('Could not allocate a backup path')
}

async function restoreBackup(targetPath: string, backupPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true })
  await rename(backupPath, targetPath)
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
    const targetPath = installation.unresolvedPath
    const backupPath = await collisionSafeBackupPath(
      targetPath,
      (this.deps.now ?? Date.now)(),
      this.deps.randomId ?? (() => randomBytes(4).toString('hex'))
    )
    await rename(targetPath, backupPath)
    let installed: InstallerResult
    try {
      installed = await (this.deps.runInstaller ?? defaultInstaller)(
        installation.name,
        installAgents(installation)
      )
    } catch (error) {
      await restoreBackup(targetPath, backupPath)
      return {
        repaired: false,
        reason: 'install-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    if (installed.code !== 0) {
      await restoreBackup(targetPath, backupPath)
      return { repaired: false, reason: 'install-failed', message: installed.output }
    }
    let inventory: SkillFreshnessInventory
    try {
      inventory = await this.deps.scan()
    } catch (error) {
      await restoreBackup(targetPath, backupPath)
      return {
        repaired: false,
        reason: 'did-not-converge',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    // The canonical copy wins physical deduplication after install, so the original
    // provider placement id can legitimately disappear when it becomes an alias.
    const repaired = inventory.installations.find(
      (entry) =>
        entry.name === installation.name &&
        entry.status === 'current' &&
        (entry.topology === 'canonical-copy' || entry.topology === 'provider-alias')
    )
    if (!repaired) {
      await restoreBackup(targetPath, backupPath)
      return {
        repaired: false,
        reason: 'did-not-converge',
        message: 'The installer finished, but the repaired copy is not current.'
      }
    }
    return { repaired: true, name: installation.name, backupPath, inventory }
  }
}
