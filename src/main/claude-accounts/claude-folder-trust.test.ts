import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claudeConfigFilePathOf,
  claudeFolderTrustPathsOf,
  claudeLaunchRequiresFolderTrust,
  claudeProjectKeyOf,
  isClaudeFolderTrusted,
  markClaudeFolderTrusted,
  withClaudeFolderTrust
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

describe('claudeProjectKeyOf', () => {
  it('keys a Windows folder with forward slashes, as Claude does', () => {
    expect(claudeProjectKeyOf('C:\\work\\repo', 'win32')).toBe('C:/work/repo')
  })

  it('keeps a POSIX folder as is', () => {
    expect(claudeProjectKeyOf('/work/repo', 'linux')).toBe('/work/repo')
  })
})

describe('withClaudeFolderTrust', () => {
  it('accepts the trust dialog for a folder and keeps every other key', () => {
    const existing = JSON.stringify({
      oauthAccount: { emailAddress: 'a@b.c' },
      projects: { '/work/other': { allowedTools: ['Bash'], hasTrustDialogAccepted: true } }
    })

    const next = JSON.parse(withClaudeFolderTrust(existing, ['/work/repo']) ?? 'null')

    expect(next.oauthAccount).toEqual({ emailAddress: 'a@b.c' })
    expect(next.projects['/work/other']).toEqual({
      allowedTools: ['Bash'],
      hasTrustDialogAccepted: true
    })
    expect(next.projects['/work/repo']).toMatchObject({
      allowedTools: [],
      hasTrustDialogAccepted: true
    })
  })

  it('keeps the existing project settings when it flips the trust flag', () => {
    const existing = JSON.stringify({
      projects: { '/work/repo': { allowedTools: ['Read'], hasTrustDialogAccepted: false } }
    })

    const next = JSON.parse(withClaudeFolderTrust(existing, ['/work/repo']) ?? 'null')

    expect(next.projects['/work/repo']).toEqual({
      allowedTools: ['Read'],
      hasTrustDialogAccepted: true
    })
  })

  it('returns the content unchanged when the folder is already trusted', () => {
    const existing = JSON.stringify({
      projects: { '/work/repo': { hasTrustDialogAccepted: true } }
    })

    expect(withClaudeFolderTrust(existing, ['/work/repo'])).toBe(existing)
  })

  it('refuses to rewrite a config that is not a JSON object', () => {
    expect(withClaudeFolderTrust('{not json', ['/work/repo'])).toBeNull()
    expect(withClaudeFolderTrust('[]', ['/work/repo'])).toBeNull()
  })
})

describe('markClaudeFolderTrusted', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function fixture(): Promise<{ configDir: string; folder: string }> {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-792-mark-')))
    roots.push(root)
    const folder = join(root, 'worktree')
    await mkdir(folder)
    return { configDir: join(root, 'account'), folder }
  }

  it('creates the config file in a config dir that does not exist yet', async () => {
    const { configDir, folder } = await fixture()
    const configFilePath = join(configDir, '.claude.json')

    await markClaudeFolderTrusted({ configFilePath, folderPath: folder })

    await expect(isClaudeFolderTrusted({ configFilePath, folderPaths: [folder] })).resolves.toBe(
      true
    )
  })

  it('keeps the other keys of an existing config', async () => {
    const { configDir, folder } = await fixture()
    const configFilePath = join(configDir, '.claude.json')
    await mkdir(configDir)
    await writeFile(configFilePath, JSON.stringify({ numStartups: 7, projects: {} }))

    await markClaudeFolderTrusted({ configFilePath, folderPath: folder })

    const config = JSON.parse(await readFile(configFilePath, 'utf8'))
    expect(config.numStartups).toBe(7)
    expect(config.projects[folder].hasTrustDialogAccepted).toBe(true)
  })

  it('leaves a config it cannot parse untouched', async () => {
    const { configDir, folder } = await fixture()
    const configFilePath = join(configDir, '.claude.json')
    await mkdir(configDir)
    await writeFile(configFilePath, '{not json')

    await markClaudeFolderTrusted({ configFilePath, folderPath: folder })

    await expect(readFile(configFilePath, 'utf8')).resolves.toBe('{not json')
  })
})

describe('claudeLaunchRequiresFolderTrust', () => {
  it('requires trust for a dispatched worker and a game member, so a trust prompt never eats the preamble', () => {
    expect(
      claudeLaunchRequiresFolderTrust({ launchAgent: 'claude', orchestrationWorker: true })
    ).toBe(true)
    expect(
      claudeLaunchRequiresFolderTrust({ launchAgent: 'claude', orchestrationGameMember: true })
    ).toBe(true)
  })

  it('leaves interactive and non-Claude launches alone', () => {
    expect(claudeLaunchRequiresFolderTrust({ launchAgent: 'claude' })).toBe(false)
    expect(
      claudeLaunchRequiresFolderTrust({ launchAgent: 'codex', orchestrationWorker: true })
    ).toBe(false)
  })
})
