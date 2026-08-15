import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SkillBundleFileIdentity,
  SkillCurrentBundleEntry,
  SkillFreshnessInstallation,
  SkillFreshnessInventory,
  SkillKnownSnapshot
} from '../../shared/skill-freshness'
import { inventorySkillFreshness } from './skill-freshness-inventory'
import { describeObservedSkillFile, skillPackageDigest } from './skill-package-identity'
import { buildSkillRepairInstallArgs, SkillUnrecognizedRepair } from './skill-unrecognized-repair'

const SKILL = 'switch-account'
const OFFICIAL_MARKDOWN =
  '---\nname: switch-account\ndescription: Official guide.\n---\n\n# Switch account\n'
// The measured reproduction: a real directory whose SKILL.md is an older copy of the
// official one — fewer lines, none of its own.
const STALE_MARKDOWN = '---\nname: switch-account\ndescription: Official guide.\n---\n'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

function snapshot(releaseRevision: number, markdown: string): SkillKnownSnapshot {
  const observed = describeObservedSkillFile('SKILL.md', Buffer.from(markdown), false)
  const file: SkillBundleFileIdentity = {
    path: observed.path,
    size: observed.size,
    executable: observed.executable,
    classification: observed.classification,
    exactSha256: observed.exactSha256,
    textNormalizedSha256: observed.textNormalizedSha256,
    identitySha256: observed.identitySha256
  }
  return {
    releaseRevision,
    packageDigest: skillPackageDigest([file]),
    gitTreeSha: releaseRevision.toString(16).padStart(40, '0'),
    files: [file]
  }
}

/**
 * A real home and a real bundle on disk, scanned by the production inventory. The
 * repair's verdict is only worth anything if the same classifier the dialog reads
 * decides it — a hand-written inventory would agree with whatever the code claims.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-skill-repair-'))
  temporaryDirectories.push(root)
  const homeDir = join(root, 'home')
  const resourceRoot = join(root, 'resources')
  const skillResourceRoot = join(resourceRoot, 'skills')
  await mkdir(skillResourceRoot, { recursive: true })

  const official = snapshot(2, OFFICIAL_MARKDOWN)
  const current: SkillCurrentBundleEntry = {
    name: SKILL,
    sourcePath: `skills/${SKILL}`,
    ...official
  }
  await Promise.all([
    writeFile(
      join(skillResourceRoot, 'current-manifest.json'),
      `${JSON.stringify({ schemaVersion: 2, skills: [current] }, null, 2)}\n`
    ),
    writeFile(
      join(skillResourceRoot, 'current-content.json'),
      `${JSON.stringify({ schemaVersion: 1, skills: { [SKILL]: OFFICIAL_MARKDOWN } }, null, 2)}\n`
    ),
    writeFile(
      join(skillResourceRoot, 'snapshot-registry.json'),
      `${JSON.stringify({ schemaVersion: 1, skills: { [SKILL]: [official] } }, null, 2)}\n`
    ),
    writeFile(
      join(skillResourceRoot, 'release-mapping.json'),
      `${JSON.stringify(
        { schemaVersion: 1, releases: [{ appVersion: '2.0.0', skills: { [SKILL]: 2 } }] },
        null,
        2
      )}\n`
    )
  ])

  const providerPath = join(homeDir, '.claude', 'skills', SKILL)
  const canonicalPath = join(homeDir, '.agents', 'skills', SKILL)
  const writePackage = async (directory: string, markdown: string): Promise<void> => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), markdown)
  }
  const scan = (): Promise<SkillFreshnessInventory> =>
    inventorySkillFreshness({
      currentAppVersion: '2.0.0',
      homeDir,
      resourceRoot,
      // Why: no updater lock in this home, so nothing can vouch for the copy's bytes
      // and the scan has to judge them for itself.
      stateHome: null
    })
  const placementAt = async (path: string): Promise<SkillFreshnessInstallation | undefined> =>
    (await scan()).installations.find((entry) => entry.unresolvedPath === path)

  return { root, homeDir, providerPath, canonicalPath, writePackage, scan, placementAt }
}

function repairer(
  test: Awaited<ReturnType<typeof fixture>>,
  runInstaller: (
    name: string,
    agents: readonly string[]
  ) => Promise<{
    code: number
    output: string
  }>
): SkillUnrecognizedRepair {
  return new SkillUnrecognizedRepair({
    scan: test.scan,
    runInstaller,
    homeDir: () => test.homeDir,
    now: () => 1234,
    randomId: () => 'abc'
  })
}

/**
 * Exactly what `skills add --global --agent universal` leaves behind, measured against
 * the real CLI: the canonical copy and nothing else. The provider alias is the repair's
 * own work, so a stub must not hand it over for free.
 */
async function installCanonicalOnly(test: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await test.writePackage(test.canonicalPath, OFFICIAL_MARKDOWN)
}

async function repairProviderCopy(
  test: Awaited<ReturnType<typeof fixture>>,
  runInstaller: (
    name: string,
    agents: readonly string[]
  ) => Promise<{
    code: number
    output: string
  }>
) {
  const before = await test.placementAt(test.providerPath)
  expect(before?.status).toBe('unrecognized')
  return repairer(test, runInstaller).repair({
    placementId: before!.id,
    expectedObservedPackageDigest: before!.observedPackageDigest!
  })
}

describe('SkillUnrecognizedRepair', () => {
  it('installs the canonical copy rather than a second one in the provider home', () => {
    expect(buildSkillRepairInstallArgs(SKILL, ['universal'])).toEqual([
      '--yes',
      'skills',
      'add',
      'https://github.com/ab2webco/orca-oss',
      '--skill',
      SKILL,
      '--global',
      '--agent',
      'universal',
      '-y'
    ])
  })

  it('reports the reproduced state: a real directory in a provider home is an unrecognized independent copy', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    expect(await test.placementAt(test.providerPath)).toMatchObject({
      status: 'unrecognized',
      topology: 'independent-copy',
      rootId: 'home-claude'
    })
  })

  it('leaves the provider path an alias of the canonical copy, so a re-opened dialog reads current', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    const result = await repairProviderCopy(test, async (name, agents) => {
      expect(name).toBe(SKILL)
      expect(agents).toEqual(['universal'])
      await installCanonicalOnly(test)
      return { code: 0, output: 'installed' }
    })

    expect(result).toMatchObject({ repaired: true, name: SKILL })
    // The acceptance criterion, read back off disk by the same scan the dialog uses.
    expect((await lstat(test.providerPath)).isSymbolicLink()).toBe(true)
    const reopened = await test.scan()
    const alias = reopened.installations.filter((entry) => entry.name === SKILL)
    expect(alias.every((entry) => entry.status === 'current')).toBe(true)
    expect(alias.some((entry) => entry.providers.includes('claude'))).toBe(true)
    expect(
      alias.some((entry) => entry.topology === 'canonical-copy' && entry.resolvedPath !== null)
    ).toBe(true)
    expect(result.repaired && (await readFile(join(result.backupPath, 'SKILL.md'), 'utf8'))).toBe(
      STALE_MARKDOWN
    )
  })

  it('refuses an installer that copies into the provider home instead of the canonical root', async () => {
    const test = await fixture()
    await test.writePackage(test.canonicalPath, OFFICIAL_MARKDOWN)
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    const result = await repairProviderCopy(test, async () => {
      // What an `--agent claude-code` install measurably does: official bytes, wrong
      // layout — current today, unrecognized again on the next release.
      await test.writePackage(test.providerPath, OFFICIAL_MARKDOWN)
      return { code: 0, output: 'installed' }
    })

    // The healthy canonical copy is exactly what a name match would accept as proof.
    expect(result).toMatchObject({ repaired: false, reason: 'did-not-converge' })
    expect(await readFile(join(test.providerPath, 'SKILL.md'), 'utf8')).toBe(STALE_MARKDOWN)
    expect((await lstat(test.providerPath)).isSymbolicLink()).toBe(false)
    // The canonical copy predates the repair, so a rollback must not take it away.
    expect(await readFile(join(test.canonicalPath, 'SKILL.md'), 'utf8')).toBe(OFFICIAL_MARKDOWN)
  })

  it('refuses to call it repaired when the installer silently installs nothing', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    // `skills update` reports a removed skill as available and does nothing; an exit
    // code alone cannot tell that apart from a real install.
    const result = await repairProviderCopy(test, async () => ({ code: 0, output: 'up to date' }))

    expect(result).toMatchObject({ repaired: false, reason: 'did-not-converge' })
    expect(await readFile(join(test.providerPath, 'SKILL.md'), 'utf8')).toBe(STALE_MARKDOWN)
    expect((await lstat(test.providerPath)).isSymbolicLink()).toBe(false)
  })

  it('adopts a canonical copy the user already had, which is the layout the update converges', async () => {
    const test = await fixture()
    await test.writePackage(test.canonicalPath, OFFICIAL_MARKDOWN)
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    const result = await repairProviderCopy(test, async () => ({ code: 0, output: 'up to date' }))

    expect(result).toMatchObject({ repaired: true, name: SKILL })
    expect((await lstat(test.providerPath)).isSymbolicLink()).toBe(true)
    expect(await test.placementAt(test.providerPath)).toBeUndefined()
    expect(
      (await test.scan()).installations.filter(
        (entry) => entry.name === SKILL && entry.status !== 'current'
      )
    ).toHaveLength(0)
  })

  it('removes a canonical copy its own install created when the result is not official', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    const result = await repairProviderCopy(test, async () => {
      await test.writePackage(test.canonicalPath, '# not the official skill\n')
      return { code: 0, output: 'installed' }
    })

    expect(result).toMatchObject({ repaired: false, reason: 'did-not-converge' })
    expect(await readFile(join(test.providerPath, 'SKILL.md'), 'utf8')).toBe(STALE_MARKDOWN)
    // An orphan here is a second unrecognized copy the next scan would report.
    await expect(lstat(test.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await test.scan()).installations.filter((entry) => entry.name === SKILL)).toHaveLength(
      1
    )
  })

  it('rolls the original copy back when the canonical installer fails', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    const result = await repairProviderCopy(test, async () => {
      await test.writePackage(test.canonicalPath, OFFICIAL_MARKDOWN)
      return { code: 1, output: 'network failed' }
    })

    expect(result).toMatchObject({ repaired: false, reason: 'install-failed' })
    expect(await readFile(join(test.providerPath, 'SKILL.md'), 'utf8')).toBe(STALE_MARKDOWN)
    await expect(lstat(test.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps backups under the user home, not above a nested provider root', async () => {
    const test = await fixture()
    const nestedProviderPath = join(test.homeDir, '.config', 'opencode', 'skills', SKILL)
    await test.writePackage(nestedProviderPath, STALE_MARKDOWN)

    const before = await test.placementAt(nestedProviderPath)
    const result = await repairer(test, async () => {
      await test.writePackage(test.canonicalPath, OFFICIAL_MARKDOWN)
      return { code: 0, output: 'installed' }
    }).repair({
      placementId: before!.id,
      expectedObservedPackageDigest: before!.observedPackageDigest!
    })

    expect(result).toMatchObject({
      repaired: true,
      backupPath: join(test.homeDir, '.orca', 'skill-backups', `${SKILL}-1234-abc`)
    })
  })

  it('does not offer a repair for a copy the user does not own', async () => {
    const test = await fixture()
    const repoPath = join(test.root, 'repo', '.agents', 'skills', SKILL)
    await test.writePackage(repoPath, STALE_MARKDOWN)
    const scan = vi.fn(async () => {
      const inventory = await test.scan()
      return {
        ...inventory,
        installations: [
          {
            ...(await test.placementAt(test.providerPath))!,
            id: 'repo-placement',
            unresolvedPath: repoPath,
            resolvedPath: repoPath,
            topology: 'repo-scope' as const,
            sourceKind: 'repo' as const
          }
        ]
      }
    })
    await test.writePackage(test.providerPath, STALE_MARKDOWN)

    await expect(
      new SkillUnrecognizedRepair({ scan, homeDir: () => test.homeDir }).preview('repo-placement')
    ).rejects.toThrow('not repairable')
  })

  it('previews the lines the replacement removes and adds', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)
    await writeFile(join(test.providerPath, 'my-notes.md'), 'user-only-note\n')
    const placement = await test.placementAt(test.providerPath)

    const preview = await new SkillUnrecognizedRepair({
      scan: test.scan,
      homeDir: () => test.homeDir,
      readOfficialSkill: vi.fn().mockResolvedValue(`### SKILL.md\n${OFFICIAL_MARKDOWN}`)
    }).preview(placement!.id)

    expect(preview.diff).toContain('user-only-note')
    expect(preview.diff).toContain('+# Switch account')
    expect(preview.removedLines).toBeGreaterThan(0)
    expect(preview.addedLines).toBeGreaterThan(0)
  })

  it('rejects repair when the copy changed after the preview', async () => {
    const test = await fixture()
    await test.writePackage(test.providerPath, STALE_MARKDOWN)
    const placement = await test.placementAt(test.providerPath)

    await expect(
      repairer(test, async () => {
        await cp(test.providerPath, test.canonicalPath, { recursive: true })
        return { code: 0, output: 'installed' }
      }).repair({
        placementId: placement!.id,
        expectedObservedPackageDigest: 'a-digest-from-an-older-preview'
      })
    ).resolves.toMatchObject({ repaired: false, reason: 'copy-changed' })
    expect(await readFile(join(test.providerPath, 'SKILL.md'), 'utf8')).toBe(STALE_MARKDOWN)
  })
})
