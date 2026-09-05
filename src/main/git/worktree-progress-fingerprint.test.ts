import { describe, expect, it, vi } from 'vitest'
import {
  readWorktreeProgressFingerprint,
  worktreeProgressGitExecOptions,
  type WorktreeProgressGitExec
} from './worktree-progress-fingerprint'

type GitKey = 'head' | 'status' | 'diff' | 'lsFiles' | 'hashObject' | 'symbolicRef'
type FakeGit = Partial<Record<GitKey, string | Error>>

function keyFor(args: string[]): GitKey {
  switch (args[0]) {
    case 'rev-parse':
      return 'head'
    case 'status':
      return 'status'
    case 'ls-files':
      return 'lsFiles'
    case 'hash-object':
      return 'hashObject'
    case 'symbolic-ref':
      return 'symbolicRef'
    default:
      return 'diff'
  }
}

function fakeExec(responses: FakeGit): WorktreeProgressGitExec {
  return vi.fn(async (args: string[]) => {
    const value = responses[keyFor(args)]
    if (value instanceof Error) {
      throw value
    }
    return { stdout: value ?? '' }
  })
}

async function fingerprintOf(responses: FakeGit): Promise<string> {
  const result = await readWorktreeProgressFingerprint(fakeExec(responses))
  if (result.kind !== 'fingerprint') {
    throw new Error(`expected a fingerprint, got ${result.kind}`)
  }
  return result.value
}

const baseline: FakeGit = {
  head: 'aaa111\n',
  status: ' M src/app.ts\0',
  diff: '--- a/src/app.ts\n+++ b/src/app.ts\n+first\n'
}

const unborn: FakeGit = {
  head: new Error('fatal: bad revision'),
  diff: new Error('fatal: bad revision'),
  symbolicRef: 'refs/heads/main\n'
}

describe('worktreeProgressGitExecOptions', () => {
  it("disables optional locks so the probe cannot break the watched agent's own commit", () => {
    // status and diff refresh the index, which takes .git/index.lock; the probe runs in the
    // worktree the agent is working in, so without this it fails that agent's git add.
    expect(worktreeProgressGitExecOptions('/repo/wt', {}).env?.GIT_OPTIONAL_LOCKS).toBe('0')
  })

  it('keeps the host routing and bounds every reading', () => {
    const options = worktreeProgressGitExecOptions('/repo/wt', { wslDistro: 'Ubuntu' })

    expect(options.cwd).toBe('/repo/wt')
    expect(options.wslDistro).toBe('Ubuntu')
    expect(options.timeout).toBeGreaterThan(0)
    expect(options.maxBuffer).toBeGreaterThan(0)
  })

  it('passes stdin only when there is some', () => {
    expect('stdin' in worktreeProgressGitExecOptions('/repo/wt', {})).toBe(false)
    expect(worktreeProgressGitExecOptions('/repo/wt', {}, 'a.ts\n').stdin).toBe('a.ts\n')
  })
})

describe('readWorktreeProgressFingerprint', () => {
  it('is stable across reads of an unchanged worktree', async () => {
    expect(await fingerprintOf(baseline)).toBe(await fingerprintOf(baseline))
  })

  it('changes when a new commit lands', async () => {
    expect(await fingerprintOf({ ...baseline, head: 'bbb222\n' })).not.toBe(
      await fingerprintOf(baseline)
    )
  })

  it('changes when an already-modified file is edited again', async () => {
    // The porcelain line stays ` M src/app.ts` byte for byte; only the diff moves. A
    // status-only fingerprint would report 45 minutes of real editing as a stall.
    const edited: FakeGit = {
      ...baseline,
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n+first\n+second\n'
    }

    expect(await fingerprintOf(edited)).not.toBe(await fingerprintOf(baseline))
  })

  it('changes when an untracked file appears', async () => {
    expect(await fingerprintOf({ ...baseline, status: ' M src/app.ts\0?? notes.md\0' })).not.toBe(
      await fingerprintOf(baseline)
    )
  })

  it('changes when an existing untracked file is edited', async () => {
    // `status -z` emits the path only and `diff HEAD` excludes untracked files, so the blob
    // hashes are the only part that moves while an agent iterates on a brand-new file.
    const untracked: FakeGit = { ...baseline, lsFiles: 'notes.md\0' }
    const before = await fingerprintOf({ ...untracked, hashObject: 'aaaa\n' })
    const after = await fingerprintOf({ ...untracked, hashObject: 'bbbb\n' })

    expect(after).not.toBe(before)
  })

  it('hashes untracked blobs by path, skipping any path it cannot pass on stdin', async () => {
    const exec = fakeExec({ ...baseline, lsFiles: 'notes.md\0bad\nname.md\0deep/a.ts\0' })

    await readWorktreeProgressFingerprint(exec)

    expect(exec).toHaveBeenCalledWith(['hash-object', '--stdin-paths'], {
      stdin: 'notes.md\ndeep/a.ts\n'
    })
  })

  it('does not hash blobs when there are no untracked files', async () => {
    const exec = fakeExec({ ...baseline, lsFiles: '' })

    await readWorktreeProgressFingerprint(exec)

    expect(exec).not.toHaveBeenCalledWith(['hash-object', '--stdin-paths'], expect.anything())
  })

  it('distinguishes a clean tree at one commit from a clean tree at another', async () => {
    const cleanA: FakeGit = { head: 'aaa111\n', status: '', diff: '' }
    const cleanB: FakeGit = { head: 'bbb222\n', status: '', diff: '' }

    expect(await fingerprintOf(cleanA)).not.toBe(await fingerprintOf(cleanB))
  })

  it('reads as unreadable when git status fails', async () => {
    const result = await readWorktreeProgressFingerprint(
      fakeExec({ ...baseline, status: new Error('timed out') })
    )

    expect(result).toEqual({ kind: 'unreadable' })
  })

  it('reads as unreadable when the diff fails but HEAD resolves', async () => {
    const result = await readWorktreeProgressFingerprint(
      fakeExec({ ...baseline, diff: new Error('stdout exceeded maxBuffer') })
    )

    expect(result).toEqual({ kind: 'unreadable' })
  })

  it('reads as unreadable when the untracked listing fails', async () => {
    const result = await readWorktreeProgressFingerprint(
      fakeExec({ ...baseline, lsFiles: new Error('timed out') })
    )

    expect(result).toEqual({ kind: 'unreadable' })
  })

  it('reads as unreadable when hashing the untracked blobs fails', async () => {
    const result = await readWorktreeProgressFingerprint(
      fakeExec({ ...baseline, lsFiles: 'notes.md\0', hashObject: new Error('EMFILE') })
    )

    expect(result).toEqual({ kind: 'unreadable' })
  })

  it('still fingerprints an unborn branch, where HEAD and diff both fail', async () => {
    const result = await readWorktreeProgressFingerprint(
      fakeExec({ ...unborn, status: '?? first.ts\0' })
    )

    expect(result.kind).toBe('fingerprint')
  })

  it('refuses to call two failed reads an unborn branch', async () => {
    // Spawn or transport failure kills symbolic-ref too; only a genuinely unborn branch
    // answers it. Without this the digest silently collapses to the status line, which
    // repeats byte for byte while an agent edits.
    const result = await readWorktreeProgressFingerprint(
      fakeExec({
        head: new Error('EAGAIN'),
        diff: new Error('EAGAIN'),
        symbolicRef: new Error('EAGAIN'),
        status: ' M src/app.ts\0'
      })
    )

    expect(result).toEqual({ kind: 'unreadable' })
  })

  it('sees an untracked file being edited on an unborn branch', async () => {
    const before = await fingerprintOf({
      ...unborn,
      status: '?? first.ts\0',
      lsFiles: 'first.ts\0',
      hashObject: 'aaaa\n'
    })
    const after = await fingerprintOf({
      ...unborn,
      status: '?? first.ts\0',
      lsFiles: 'first.ts\0',
      hashObject: 'bbbb\n'
    })

    expect(after).not.toBe(before)
  })

  it('does not let field boundaries collide between HEAD, status and diff', async () => {
    // Concatenated without separators both read "aabbcc".
    const a = await fingerprintOf({ head: 'aa', status: 'bb', diff: 'cc' })
    const b = await fingerprintOf({ head: 'a', status: 'abb', diff: 'cc' })

    expect(a).not.toBe(b)
  })
})
