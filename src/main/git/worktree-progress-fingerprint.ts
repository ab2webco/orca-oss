import { createHash } from 'node:crypto'
import type { WorktreeProgressProbeResult } from '../../shared/worktree-progress-probe'

/** A working diff this large is pathological; overflowing reads as unreadable, never as unchanged. */
export const WORKTREE_PROGRESS_MAX_BUFFER = 64 * 1024 * 1024
export const WORKTREE_PROGRESS_TIMEOUT_MS = 20_000

export type WorktreeProgressGitExec = (args: string[]) => Promise<{ stdout: string }>

/**
 * Hashes HEAD plus the full working-tree content.
 *
 * All three parts are needed: HEAD alone misses an agent that edits without committing,
 * `status --porcelain` alone repeats byte-for-byte while an agent edits a file already
 * marked `M`, and `diff HEAD` alone misses a file git has not been told about yet.
 */
export async function readWorktreeProgressFingerprint(
  exec: WorktreeProgressGitExec
): Promise<WorktreeProgressProbeResult> {
  const status = await tryExec(exec, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status === null) {
    return { kind: 'unreadable' }
  }

  const head = await tryExec(exec, ['rev-parse', 'HEAD'])
  // An unborn branch has no HEAD, so `diff HEAD` is expected to fail with it; anywhere else a
  // failed diff would drop content from the hash and make real edits read as a stall.
  const diff = await tryExec(exec, ['diff', 'HEAD'])
  if (head !== null && diff === null) {
    return { kind: 'unreadable' }
  }

  const digest = createHash('sha256')
    .update(head ?? '')
    .update(' ')
    .update(status)
    .update(' ')
    .update(diff ?? '')
    .digest('hex')
  return { kind: 'fingerprint', value: digest }
}

async function tryExec(exec: WorktreeProgressGitExec, args: string[]): Promise<string | null> {
  try {
    return (await exec(args)).stdout
  } catch {
    return null
  }
}
