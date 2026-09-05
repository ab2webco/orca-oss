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

  it('takes the WSL direct-git route, which is the only one that carries that variable in', () => {
    // The login-shell route drops it: wsl.exe imports only what WSLENV names, and nothing
    // registers GIT_OPTIONAL_LOCKS there. Asserting the env alone would pass with it lost.
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

  const git = async (...args: string[]): Promise<void> => {
    await execFileAsync('git', args, { cwd: repo })
  }
  const exec: WorktreeProgressGitExec = async (args) => {
    const { stdout } = await execFileAsync('git', args, { cwd: repo, maxBuffer: 8 * 1024 * 1024 })
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

  it('survives an untracked dangling symlink, which git cannot open', async () => {
    // `ls-files --others` lists symlinks, so a probe that opened them would abort the whole
    // reading on one broken link and then never fire again.
    await commitFirst()
    symlinkSync(join(repo, 'missing-target'), join(repo, 'dangling'))

    expect((await readWorktreeProgressFingerprint(exec)).kind).toBe('fingerprint')
  })

  it('does not read outside the worktree, whatever an untracked file is named', async () => {
    // A name like "\057etc\057hosts" is C-quoted by git and unquotes to an absolute path.
    await commitFirst()
    writeFileSync(join(repo, '"\\057etc\\057hosts"'), '')

    expect(await fingerprint()).toBe(await fingerprint())
  })

  it('known gap: the content of an untracked file is not measured', async () => {
    // Pinned on purpose for this slice. An agent that only ever edits brand-new files it has
    // not added reads as stalled; the escalation copy says so, and slice 2 closes it.
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
        await execFileAsync('git', args, { cwd: sub })
      }
      writeFileSync(join(sub, 'lib.ts'), 'a\n')
      await execFileAsync('git', ['add', 'lib.ts'], { cwd: sub })
      await execFileAsync('git', ['commit', '-qm', 'sub'], { cwd: sub })
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
