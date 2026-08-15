import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory
} from '../../shared/skill-freshness'
import { buildSkillRepairInstallArgs, SkillUnrecognizedRepair } from './skill-unrecognized-repair'

function placement(
  path: string,
  overrides: Partial<SkillFreshnessInstallation> = {}
): SkillFreshnessInstallation {
  return {
    id: 'stable-placement',
    name: 'switch-account',
    rootId: 'home-claude',
    providers: ['claude'],
    sourceKind: 'home',
    sourceLabel: 'Claude home',
    unresolvedPath: path,
    resolvedPath: path,
    physicalIdentity: '1:2',
    topology: 'independent-copy',
    status: 'unrecognized',
    installedReleaseRevision: null,
    installedAppVersion: null,
    currentReleaseRevision: 2,
    currentPackageDigest: 'official-digest',
    currentAppVersion: '2.0.0',
    observedPackageDigest: 'local-digest',
    errorCategory: null,
    ...overrides
  }
}

function inventory(entry: SkillFreshnessInstallation): SkillFreshnessInventory {
  return {
    schemaVersion: 1,
    installations: [entry],
    eligibleUpdateNames: [],
    scanIssues: [],
    scannedAt: 1
  }
}

describe('SkillUnrecognizedRepair', () => {
  it('uses the canonical installer command for the affected provider', () => {
    expect(buildSkillRepairInstallArgs('switch-account', ['claude-code'])).toEqual([
      '--yes',
      'skills',
      'add',
      'https://github.com/ab2webco/orca-oss',
      '--skill',
      'switch-account',
      '--global',
      '--agent',
      'claude-code',
      '-y'
    ])
  })

  it('previews official and user-only lines from a fresh placement scan', async () => {
    const path = '/home/alice/.claude/skills/switch-account'
    const scan = vi.fn().mockResolvedValue(inventory(placement(path)))
    const repair = new SkillUnrecognizedRepair({
      scan,
      readInstalledSkill: vi.fn().mockResolvedValue('# Skill\nuser-only\n'),
      readOfficialSkill: vi.fn().mockResolvedValue('# Skill\nofficial-only\n')
    })

    const preview = await repair.preview('stable-placement')

    expect(scan).toHaveBeenCalledTimes(1)
    expect(preview).toMatchObject({ addedLines: 1, removedLines: 1 })
    expect(preview.diff).toContain('-user-only')
    expect(preview.diff).toContain('+official-only')
  })

  it('includes lines from user-only files in the preview', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-skill-repair-preview-'))
    const path = join(home, '.claude', 'skills', 'switch-account')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'SKILL.md'), '# Skill\n')
    await writeFile(join(path, 'my-notes.md'), 'user-only-note\n')
    const repair = new SkillUnrecognizedRepair({
      scan: vi.fn().mockResolvedValue(inventory(placement(path))),
      readOfficialSkill: vi.fn().mockResolvedValue('### SKILL.md\n# Skill\n')
    })

    const preview = await repair.preview('stable-placement')

    expect(preview.diff).toContain('user-only-note')
    expect(preview.removedLines).toBeGreaterThan(0)
  })

  it.each(['repo-scope', 'plugin-cache'] as const)(
    'refuses owner-managed %s placements',
    async (topology) => {
      const path = `/repo/.agents/skills/switch-account`
      const repair = new SkillUnrecognizedRepair({
        scan: vi.fn().mockResolvedValue(inventory(placement(path, { topology }))),
        readInstalledSkill: vi.fn(),
        readOfficialSkill: vi.fn()
      })

      await expect(repair.preview('stable-placement')).rejects.toThrow('not repairable')
    }
  )

  it('backs up the copy, installs through the canonical command, and converges the stable placement to current', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-skill-repair-'))
    const providerPath = join(home, '.claude', 'skills', 'switch-account')
    const canonicalPath = join(home, '.agents', 'skills', 'switch-account')
    await mkdir(providerPath, { recursive: true })
    await writeFile(join(providerPath, 'SKILL.md'), '# old\nuser-only\n')
    const backupRoot = join(home, '.orca', 'skill-backups')
    const collidingBackup = join(backupRoot, 'switch-account-1234-abc')
    await mkdir(collidingBackup, { recursive: true })
    let scans = 0
    const scan = vi.fn(async () => {
      scans += 1
      return inventory(
        placement(scans < 2 ? providerPath : canonicalPath, {
          id: scans < 2 ? 'stable-placement' : 'canonical-placement',
          rootId: scans < 2 ? 'home-claude' : 'home-agents',
          topology: scans < 2 ? 'independent-copy' : 'canonical-copy',
          status: scans < 2 ? 'unrecognized' : 'current',
          observedPackageDigest: scans < 2 ? 'local-digest' : 'official-digest'
        })
      )
    })
    const runInstaller = vi.fn(async (_name: string, agents: readonly string[]) => {
      expect(agents).toEqual(['claude-code'])
      await mkdir(canonicalPath, { recursive: true })
      await writeFile(join(canonicalPath, 'SKILL.md'), '# current\n')
      await symlink(canonicalPath, providerPath, process.platform === 'win32' ? 'junction' : 'dir')
      return { code: 0, output: 'installed' }
    })
    const randomId = vi.fn().mockReturnValueOnce('abc').mockReturnValue('def')
    const repair = new SkillUnrecognizedRepair({
      scan,
      runInstaller,
      now: () => 1234,
      randomId
    })

    const result = await repair.repair({
      placementId: 'stable-placement',
      expectedObservedPackageDigest: 'local-digest'
    })

    expect(result).toMatchObject({ repaired: true, name: 'switch-account' })
    expect((await lstat(providerPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(canonicalPath, 'SKILL.md'), 'utf8')).toBe('# current\n')
    expect(result.repaired && result.backupPath).toBe(join(backupRoot, 'switch-account-1234-def'))
    expect((await lstat(collidingBackup)).isDirectory()).toBe(true)
  })

  it('rolls the original copy back when the canonical installer fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-skill-repair-rollback-'))
    const providerPath = join(home, '.claude', 'skills', 'switch-account')
    await mkdir(providerPath, { recursive: true })
    await writeFile(join(providerPath, 'SKILL.md'), 'user work\n')
    const repair = new SkillUnrecognizedRepair({
      scan: vi.fn().mockResolvedValue(inventory(placement(providerPath))),
      runInstaller: vi.fn().mockResolvedValue({ code: 1, output: 'network failed' }),
      now: () => 1234,
      randomId: () => 'abc'
    })

    const result = await repair.repair({
      placementId: 'stable-placement',
      expectedObservedPackageDigest: 'local-digest'
    })

    expect(result).toMatchObject({ repaired: false, reason: 'install-failed' })
    expect(await readFile(join(providerPath, 'SKILL.md'), 'utf8')).toBe('user work\n')
  })

  it('rejects repair when the fresh scan no longer matches the previewed copy', async () => {
    const path = '/home/alice/.claude/skills/switch-account'
    const repair = new SkillUnrecognizedRepair({
      scan: vi
        .fn()
        .mockResolvedValue(inventory(placement(path, { observedPackageDigest: 'changed' }))),
      runInstaller: vi.fn()
    })

    await expect(
      repair.repair({
        placementId: 'stable-placement',
        expectedObservedPackageDigest: 'local-digest'
      })
    ).resolves.toMatchObject({ repaired: false, reason: 'copy-changed' })
  })
})
