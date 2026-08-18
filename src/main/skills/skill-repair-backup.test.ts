import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalSkillPath, linkProviderAliasToCanonical } from './skill-repair-backup'

const SKILL = 'switch-account'
const SKILL_MARKDOWN = '---\nname: switch-account\ndescription: Official guide.\n---\n'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

// Resolved: macOS puts tmpdir behind /var -> /private/var, and a logical root would make
// every path in the fixture indirect before the case under test adds its own symlink.
async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-skill-repair-')))
  temporaryDirectories.push(root)
  return root
}

async function makeCanonical(home: string): Promise<string> {
  const canonicalPath = canonicalSkillPath(home, SKILL)
  await mkdir(canonicalPath, { recursive: true })
  await writeFile(join(canonicalPath, 'SKILL.md'), SKILL_MARKDOWN)
  return canonicalPath
}

function parentHops(linkText: string): number {
  return linkText.split('/').filter((segment) => segment === '..').length
}

describe('linkProviderAliasToCanonical', () => {
  it.skipIf(process.platform === 'win32')(
    'reaches the canonical copy when the provider skills root is itself a symlink',
    async () => {
      const root = await makeRoot()
      const home = join(root, 'home')
      const canonicalPath = await makeCanonical(home)

      // The managed-vault shape: the alias is written to a path seven levels below home,
      // but that path is a symlink onto a provider root only two levels below it.
      const providerRoot = join(home, '.claude', 'skills')
      await mkdir(providerRoot, { recursive: true })
      const vaultSkills = join(
        home,
        'Library',
        'Application Support',
        'orca',
        'claude-accounts',
        'account-id',
        'auth',
        'skills'
      )
      await mkdir(join(vaultSkills, '..'), { recursive: true })
      await symlink(providerRoot, vaultSkills, 'dir')

      const targetPath = join(vaultSkills, SKILL)
      await linkProviderAliasToCanonical(targetPath, canonicalPath)

      expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN)
      expect(await realpath(targetPath)).toBe(canonicalPath)
      expect(parentHops(await readlink(targetPath))).toBe(2)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'still links relatively when the provider root is a real directory',
    async () => {
      const root = await makeRoot()
      const home = join(root, 'home')
      const canonicalPath = await makeCanonical(home)
      const targetPath = join(home, '.claude', 'skills', SKILL)

      await linkProviderAliasToCanonical(targetPath, canonicalPath)

      expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN)
      expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
      expect(parentHops(await readlink(targetPath))).toBe(2)
    }
  )

  // Not a mutation control: the link resolves whether or not the canonical end is
  // realpath'd, so this pins the contract, not an implementation choice.
  it.skipIf(process.platform === 'win32')(
    'reaches a canonical copy that is itself behind a symlink',
    async () => {
      const root = await makeRoot()
      const home = join(root, 'home')
      const store = join(home, 'store', 'agents', 'skills', SKILL)
      await mkdir(store, { recursive: true })
      await writeFile(join(store, 'SKILL.md'), SKILL_MARKDOWN)
      await symlink(join(home, 'store', 'agents'), join(home, '.agents'), 'dir')
      const canonicalPath = canonicalSkillPath(home, SKILL)

      const providerRoot = join(home, '.claude', 'skills')
      await mkdir(providerRoot, { recursive: true })
      const vaultSkills = join(home, 'Library', 'Application Support', 'orca', 'auth', 'skills')
      await mkdir(join(vaultSkills, '..'), { recursive: true })
      await symlink(providerRoot, vaultSkills, 'dir')

      const targetPath = join(vaultSkills, SKILL)
      await linkProviderAliasToCanonical(targetPath, canonicalPath)

      expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN)
      expect(await realpath(targetPath)).toBe(store)
      // Both spellings reach the file, so only the link text says which one was written:
      // resolving the canonical would pin `store/agents` and orphan the alias if the user
      // ever repoints `.agents`.
      expect(await readlink(targetPath)).toBe(`../../.agents/skills/${SKILL}`)
    }
  )

  it('leaves whatever the installer already wrote at the path', async () => {
    const root = await makeRoot()
    const home = join(root, 'home')
    const canonicalPath = await makeCanonical(home)
    const targetPath = join(home, '.claude', 'skills', SKILL)
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'SKILL.md'), 'installer copy')

    await linkProviderAliasToCanonical(targetPath, canonicalPath)

    expect((await lstat(targetPath)).isDirectory()).toBe(true)
    expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toBe('installer copy')
  })
})
