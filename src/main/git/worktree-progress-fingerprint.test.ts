import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readWorktreeProgressFingerprint,
  worktreeProgressGitExecOptions,
  type WorktreeProgressGitExec
} from './worktree-progress-fingerprint'

const execFileAsync = promisify(execFile)

describe('worktreeProgressGitExecOptions', () => {
  it("disables optional locks so the probe cannot break the watched agent's own commit", () => {
    expect(worktreeProgressGitExecOptions('/repo/wt', {}).env?.GIT_OPTIONAL_LOCKS).toBe('0')
  })

  it('asks for the WSL direct-git route, without which the variable cannot reach WSL at all', () => {
    // The login-shell route drops it: wsl.exe imports only what WSLENV names. This pins the
    // request, not the delivery — a cold environment cache still falls through for one read.
    expect(worktreeProgressGitExecOptions('/repo/wt', { wslDistro: 'Ubuntu' })).toMatchObject({
      cwd: '/repo/wt',
      wslDistro: 'Ubuntu',
      preferWslDirectGit: true
    })
  })

  it('bounds every reading in time and in bytes', () => {
    const options = worktreeProgressGitExecOptions('/repo/wt', {})

    expect(options.timeout).toBe(20_000)
    expect(options.maxBuffer).toBe(64 * 1024 * 1024)
  })
})

/**
 * Driven against a real git binary: this module is a contract with git's output, so a faked
 * exec proves only that the hash function is pure.
 */
describe('readWorktreeProgressFingerprint against a real repository', () => {
  let repo: string

  // Without this the pinned gaps below depend on the developer's own git setup: `diff.submodule`
  // flips one of them from pass to fail, and `~/.config/git/ignore` is read by default and can
  // hide the untracked files two of them create. HOME and XDG point at the tmpdir rather than
  // relying on GIT_CONFIG_GLOBAL, which needs git 2.32 against this repo's 2.25 floor.
  let isolatedEnv: NodeJS.ProcessEnv
  const git = async (...args: string[]): Promise<void> => {
    await execFileAsync('git', args, { cwd: repo, env: isolatedEnv })
  }
  const exec: WorktreeProgressGitExec = async (args) => {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repo,
      env: isolatedEnv,
      maxBuffer: 8 * 1024 * 1024
    })
    return { stdout: String(stdout) }
  }
  const fingerprint = async (): Promise<string> => {
    const result = await readWorktreeProgressFingerprint(exec)
    if (result.kind !== 'fingerprint') {
      throw new Error(`expected a fingerprint, got ${result.kind}`)
    }
    return result.value
  }
  const commitFirst = async (): Promise<void> => {
    writeFileSync(join(repo, 'app.ts'), 'first\n')
    await git('add', 'app.ts')
    await git('commit', '-qm', 'first')
  }

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'orca-progress-'))
    const home = mkdtempSync(join(tmpdir(), 'orca-progress-home-'))
    isolatedEnv = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1'
    }
    await git('init', '-q', '.')
    await git('config', 'user.email', 'orca@example.test')
    await git('config', 'user.name', 'Orca')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('is stable across two readings of an untouched worktree', async () => {
    await commitFirst()

    expect(await fingerprint()).toBe(await fingerprint())
  })

  it('moves when a commit lands', async () => {
    await commitFirst()
    const before = await fingerprint()

    writeFileSync(join(repo, 'app.ts'), 'second\n')
    await git('add', 'app.ts')
    await git('commit', '-qm', 'second')

    expect(await fingerprint()).not.toBe(before)
  })

  it('moves when an already-modified file is edited again', async () => {
    await commitFirst()
    writeFileSync(join(repo, 'app.ts'), 'edited once\n')
    const before = await fingerprint()

    writeFileSync(join(repo, 'app.ts'), 'edited twice\n')

    expect(await fingerprint()).not.toBe(before)
  })

  it('moves when work is staged and not committed', async () => {
    await commitFirst()
    writeFileSync(join(repo, 'app.ts'), 'fix\n')
    const before = await fingerprint()

    await git('add', 'app.ts')

    expect(await fingerprint()).not.toBe(before)
  })

  it('moves when an untracked file appears', async () => {
    await commitFirst()
    const before = await fingerprint()

    writeFileSync(join(repo, 'notes.md'), 'a\n')

    expect(await fingerprint()).not.toBe(before)
  })

  it('reads an unborn branch rather than refusing it', async () => {
    writeFileSync(join(repo, 'first.ts'), 'a\n')

    expect((await readWorktreeProgressFingerprint(exec)).kind).toBe('fingerprint')
  })

  it('reads an untracked dangling symlink as a new path, not as a file to open', async () => {
    // Slice 2 will reintroduce reading untracked content; a probe that opens these paths
    // aborts on one broken link and then never fires again.
    await commitFirst()
    const before = await fingerprint()

    symlinkSync(join(repo, 'missing-target'), join(repo, 'dangling'))

    expect(await fingerprint()).not.toBe(before)
  })

  it('is stable whatever the user has configured an external diff driver to print', async () => {
    // `git diff` runs external diff and textconv drivers by default. A wrapper that prints its
    // per-invocation temp path makes an untouched worktree hash differently on every tick, so
    // the timer reports progress forever on a pane that never moves.
    await commitFirst()
    writeFileSync(join(repo, 'app.ts'), 'edited\n')
    const driver = join(repo, 'driver.sh')
    writeFileSync(driver, '#!/bin/sh\necho "--- $2"\necho "+++ $5"\n', { mode: 0o755 })
    const execWithDriver: WorktreeProgressGitExec = async (args) => {
      const { stdout } = await execFileAsync('git', args, {
        cwd: repo,
        env: { ...isolatedEnv, GIT_EXTERNAL_DIFF: driver },
        maxBuffer: 8 * 1024 * 1024
      })
      return { stdout: String(stdout) }
    }
    const read = async (): Promise<string> => {
      const result = await readWorktreeProgressFingerprint(execWithDriver)
      if (result.kind !== 'fingerprint') {
        throw new Error(`expected a fingerprint, got ${result.kind}`)
      }
      return result.value
    }

    expect(await read()).toBe(await read())
  })

  it('known gap: the content of an untracked file is not measured', async () => {
    // Pinned on purpose: the file's appearance moves the digest, its later edits do not. An
    // agent that only iterates on unadded files reads as stalled; the escalation copy says so.
    await commitFirst()
    writeFileSync(join(repo, 'draft.ts'), 'one\n')
    const before = await fingerprint()

    writeFileSync(join(repo, 'draft.ts'), 'one\ntwo\n')

    expect(await fingerprint()).toBe(before)
  })

  it('known gap: work inside a submodule is not measured', async () => {
    const sub = mkdtempSync(join(tmpdir(), 'orca-progress-sub-'))
    try {
      for (const args of [
        ['init', '-q', '.'],
        ['config', 'user.email', 'orca@example.test'],
        ['config', 'user.name', 'Orca']
      ]) {
        await execFileAsync('git', args, { cwd: sub, env: isolatedEnv })
      }
      writeFileSync(join(sub, 'lib.ts'), 'a\n')
      await execFileAsync('git', ['add', 'lib.ts'], { cwd: sub, env: isolatedEnv })
      await execFileAsync('git', ['commit', '-qm', 'sub'], { cwd: sub, env: isolatedEnv })
      await commitFirst()
      await git('-c', 'protocol.file.allow=always', 'submodule', '-q', 'add', sub, 'vendor')
      await git('commit', '-qm', 'add submodule')
      writeFileSync(join(repo, 'vendor', 'lib.ts'), 'edited\n')
      const before = await fingerprint()

      writeFileSync(join(repo, 'vendor', 'lib.ts'), 'edited again\n')

      expect(await fingerprint()).toBe(before)
    } finally {
      rmSync(sub, { recursive: true, force: true })
    }
  })
})

describe('readWorktreeProgressFingerprint failure handling', () => {
  it('reads as unreadable when git status fails', async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') {
        throw new Error('timed out')
      }
      return { stdout: '' }
    })

    expect(await readWorktreeProgressFingerprint(exec)).toEqual({ kind: 'unreadable' })
  })

  it('reads as unreadable when the diff fails but HEAD resolves', async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'diff') {
        throw new Error('stdout exceeded maxBuffer')
      }
      return { stdout: 'aaa111\n' }
    })

    expect(await readWorktreeProgressFingerprint(exec)).toEqual({ kind: 'unreadable' })
  })

  it('refuses to call a failed HEAD read an unborn branch when the branch has commits', async () => {
    // symbolic-ref answers for any attached HEAD, born or not, so it cannot decide this on
    // its own; the ref it names still resolving proves the branch is not unborn.
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'symbolic-ref') {
        return { stdout: 'refs/heads/main\n' }
      }
      if (args[0] === 'rev-parse' && args.includes('--quiet')) {
        return { stdout: 'aaa111\n' }
      }
      if (args[0] === 'rev-parse' || args[0] === 'diff') {
        throw new Error('EAGAIN')
      }
      return { stdout: ' M app.ts\0' }
    })

    expect(await readWorktreeProgressFingerprint(exec)).toEqual({ kind: 'unreadable' })
  })

  it('reads as unreadable when nothing answers about HEAD at all', async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') {
        return { stdout: ' M app.ts\0' }
      }
      throw new Error('EAGAIN')
    })

    expect(await readWorktreeProgressFingerprint(exec)).toEqual({ kind: 'unreadable' })
  })
})
