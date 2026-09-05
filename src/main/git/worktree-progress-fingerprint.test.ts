import { describe, expect, it, vi } from 'vitest'
import {
  readWorktreeProgressFingerprint,
  type WorktreeProgressGitExec
} from './worktree-progress-fingerprint'

type FakeGit = { head?: string | Error; status?: string | Error; diff?: string | Error }

function fakeExec(responses: FakeGit): WorktreeProgressGitExec {
  return vi.fn(async (args: string[]) => {
    const key = args[0] === 'rev-parse' ? 'head' : args[0] === 'status' ? 'status' : 'diff'
    const value = responses[key]
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

  it('still fingerprints an unborn branch, where HEAD and diff both fail', async () => {
    const result = await readWorktreeProgressFingerprint(
      fakeExec({
        head: new Error('fatal: bad revision'),
        status: '?? first.ts\0',
        diff: new Error('fatal: bad revision')
      })
    )

    expect(result.kind).toBe('fingerprint')
  })

  it('sees a new untracked file on an unborn branch', async () => {
    const unborn = { head: new Error('no HEAD'), diff: new Error('no HEAD') }
    const before = await fingerprintOf({ ...unborn, status: '?? first.ts\0' })
    const after = await fingerprintOf({ ...unborn, status: '?? first.ts\0?? second.ts\0' })

    expect(after).not.toBe(before)
  })

  it('does not let field boundaries collide between HEAD, status and diff', async () => {
    // Concatenated without separators both read "aabbcc".
    const a = await fingerprintOf({ head: 'aa', status: 'bb', diff: 'cc' })
    const b = await fingerprintOf({ head: 'a', status: 'abb', diff: 'cc' })

    expect(a).not.toBe(b)
  })
})
