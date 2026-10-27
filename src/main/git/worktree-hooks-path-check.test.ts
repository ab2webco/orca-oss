import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createLocalWorktreeHooksPathProbe,
  createRemoteWorktreeHooksPathProbe,
  findWorktreeHooksPathWarning,
  resolveGitHooksDir
} from './worktree-hooks-path-check'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull }
  }).trim()
}

function writeHook(root: string, relativePath: string): void {
  const filePath = join(root, relativePath)
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
}

describe('findWorktreeHooksPathWarning with a real git repo', () => {
  let root: string
  let repo: string
  let worktree: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-hooks-path-'))
    repo = join(root, 'repo')
    worktree = join(root, 'feature')
    mkdirSync(repo)
    git(repo, 'init', '-q')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function commitAndAddWorktree(hooksPath?: string): void {
    if (hooksPath !== undefined) {
      git(repo, 'config', 'core.hooksPath', hooksPath)
    }
    git(repo, 'add', '-A')
    git(
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'i'
    )
    git(repo, 'worktree', 'add', '-q', worktree)
  }

  async function check(options?: { setupWillRun?: boolean }): Promise<string | undefined> {
    return findWorktreeHooksPathWarning(
      worktree,
      createLocalWorktreeHooksPathProbe(worktree, {}),
      options
    )
  }

  it('warns when a generated hooks dir does not exist yet but the repo ships .husky/pre-commit', async () => {
    writeHook(repo, '.husky/pre-commit')
    commitAndAddWorktree('.husky/_')

    const warning = await check()

    expect(warning).toContain('".husky/_"')
    expect(warning).toContain('".husky/pre-commit"')
    expect(git(worktree, 'config', '--get', 'core.hooksPath')).toBe('.husky/_')
  })

  it('names both paths when the hooks dir exists without pre-commit', async () => {
    mkdirSync(join(repo, '.githooks'))
    writeFileSync(join(repo, '.githooks', 'pre-push'), '#!/bin/sh\n')
    writeHook(repo, 'scripts/hooks/pre-commit')
    commitAndAddWorktree('.githooks')

    const warning = await check()

    expect(warning).toContain('".githooks"')
    expect(warning).toContain('"scripts/hooks/pre-commit"')
  })

  it('says setup may install the hooks when a setup script will run', async () => {
    writeHook(repo, '.husky/pre-commit')
    commitAndAddWorktree('.husky/_')

    expect(await check({ setupWillRun: true })).toMatch(/setup script may install/i)
  })

  it('does not warn when the effective hooks dir has a pre-commit', async () => {
    writeHook(repo, '.githooks/pre-commit')
    commitAndAddWorktree('.githooks')

    expect(await check()).toBeUndefined()
  })

  it('does not warn when the repo ships no pre-commit under any candidate path', async () => {
    writeFileSync(join(repo, 'README.md'), 'x\n')
    commitAndAddWorktree('.husky/_')

    expect(await check()).toBeUndefined()
  })
})

describe('findWorktreeHooksPathWarning through a remote provider', () => {
  it('checks the remote host with the provider exec and filesystem', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '.husky/_\n', stderr: '' })
    const stat = vi.fn(async (filePath: string) => {
      if (filePath === '/srv/feature/.husky/pre-commit') {
        return { size: 1, type: 'file' as const, mtime: 0 }
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })

    const warning = await findWorktreeHooksPathWarning(
      '/srv/feature',
      createRemoteWorktreeHooksPathProbe('/srv/feature', { exec }, { stat })
    )

    expect(exec).toHaveBeenCalledWith(
      ['rev-parse', '--git-path', 'hooks'],
      '/srv/feature',
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
    expect(stat).toHaveBeenCalledWith('/srv/feature/.husky/_/pre-commit')
    expect(warning).toContain('".husky/_"')
    expect(warning).toContain('".husky/pre-commit"')
  })

  it('never fails creation when the probe errors or hangs', async () => {
    const failing = {
      readHooksPath: () => Promise.reject(new Error('ssh down')),
      pathExists: vi.fn()
    }
    const hanging = { readHooksPath: () => new Promise<string>(() => {}), pathExists: vi.fn() }

    await expect(findWorktreeHooksPathWarning('/srv/feature', failing)).resolves.toBeUndefined()
    await expect(
      findWorktreeHooksPathWarning('/srv/feature', hanging, { timeoutMs: 10 })
    ).resolves.toBeUndefined()
  })
})

describe('resolveGitHooksDir', () => {
  it('resolves relative output against the worktree and keeps absolute output', () => {
    expect(resolveGitHooksDir('/srv/feature', '.husky/_\n')).toBe('/srv/feature/.husky/_')
    expect(resolveGitHooksDir('/srv/feature', '/srv/repo/.git/hooks')).toBe('/srv/repo/.git/hooks')
    expect(resolveGitHooksDir('C:\\work\\feature', '.husky/_')).toBe('C:\\work\\feature\\.husky\\_')
    expect(resolveGitHooksDir('C:\\work\\feature', 'C:/work/repo/.git/hooks')).toBe(
      'C:/work/repo/.git/hooks'
    )
  })

  it('maps a Linux path printed by git in WSL to its Windows UNC form', () => {
    expect(
      resolveGitHooksDir('\\\\wsl.localhost\\Ubuntu\\home\\me\\feature', '/home/me/repo/.git/hooks')
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\.git\\hooks')
  })
})
