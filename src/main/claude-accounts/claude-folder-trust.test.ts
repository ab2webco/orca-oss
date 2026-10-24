import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claudeConfigFilePathOf,
  claudeFolderTrustPathsOf,
  isClaudeFolderTrusted
} from './claude-folder-trust'

describe('claudeConfigFilePathOf', () => {
  it('reads the config dir Claude is pointed at through CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigFilePathOf({ CLAUDE_CONFIG_DIR: '/vaults/work' }, '/home/me')).toBe(
      join('/vaults/work', '.claude.json')
    )
  })

  it('falls back to the home config file when no config dir is set', () => {
    expect(claudeConfigFilePathOf({}, '/home/me')).toBe(join('/home/me', '.claude.json'))
  })
})

describe('isClaudeFolderTrusted', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function configFile(content: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'orca-776-config-'))
    roots.push(root)
    const file = join(root, '.claude.json')
    await writeFile(file, content)
    return file
  }

  it('is false when the account has no config file yet', async () => {
    const missing = join(tmpdir(), 'orca-776-missing', '.claude.json')

    await expect(
      isClaudeFolderTrusted({ configFilePath: missing, folderPaths: ['/work/repo'] })
    ).resolves.toBe(false)
  })

  it('is false when the config file is not valid JSON', async () => {
    const file = await configFile('{not json')

    await expect(
      isClaudeFolderTrusted({ configFilePath: file, folderPaths: ['/work/repo'] })
    ).resolves.toBe(false)
  })

  it('is false when the folder is listed without an accepted trust dialog', async () => {
    const file = await configFile(
      JSON.stringify({ projects: { '/work/repo': { hasTrustDialogAccepted: false } } })
    )

    await expect(
      isClaudeFolderTrusted({ configFilePath: file, folderPaths: ['/work/repo'] })
    ).resolves.toBe(false)
  })

  it('is true when the folder has an accepted trust dialog', async () => {
    const file = await configFile(
      JSON.stringify({ projects: { '/work/repo': { hasTrustDialogAccepted: true } } })
    )

    await expect(
      isClaudeFolderTrusted({ configFilePath: file, folderPaths: ['/work/other', '/work/repo'] })
    ).resolves.toBe(true)
  })
})

describe('claudeFolderTrustPathsOf', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('lists only the folder for a main checkout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-776-main-')))
    roots.push(root)
    const main = join(root, 'repo')
    await mkdir(main)
    execFileSync('git', ['init', '-q'], { cwd: main })
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'],
      { cwd: main }
    )

    expect(claudeFolderTrustPathsOf(main)).toEqual([main])
  })

  it('lists the linked worktree and its main checkout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-776-linked-')))
    roots.push(root)
    const main = join(root, 'repo')
    const worktree = join(root, 'repo-wt')
    await mkdir(main)
    execFileSync('git', ['init', '-q'], { cwd: main })
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'],
      { cwd: main }
    )
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature', worktree], { cwd: main })

    expect(claudeFolderTrustPathsOf(worktree)).toEqual([worktree, main])
  })
})
