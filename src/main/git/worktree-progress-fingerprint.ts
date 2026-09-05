import { createHash } from 'node:crypto'
import { gitOptionalLocksDisabledEnv } from './runner'
import type { WorktreeProgressProbeResult } from '../../shared/worktree-progress-probe'

/** A working diff this large is pathological; overflowing reads as unreadable, never as unchanged. */
export const WORKTREE_PROGRESS_MAX_BUFFER = 64 * 1024 * 1024
export const WORKTREE_PROGRESS_TIMEOUT_MS = 20_000

export type WorktreeProgressGitExec = (
  args: string[],
  options?: { stdin?: string }
) => Promise<{ stdout: string }>

/**
 * Exec options shared by every local probe call site.
 *
 * `GIT_OPTIONAL_LOCKS=0` is the load-bearing part: this polls the worktree an agent is
 * actively working in, and `status`/`diff` would otherwise refresh the index, take
 * `.git/index.lock`, and fail that agent's own `git add` or `git commit`.
 */
export function worktreeProgressGitExecOptions(
  cwd: string,
  hostOptions: { wslDistro?: string },
  stdin?: string
): {
  cwd: string
  wslDistro?: string
  timeout: number
  maxBuffer: number
  env: NodeJS.ProcessEnv
  stdin?: string
} {
  return {
    ...hostOptions,
    cwd,
    timeout: WORKTREE_PROGRESS_TIMEOUT_MS,
    maxBuffer: WORKTREE_PROGRESS_MAX_BUFFER,
    env: gitOptionalLocksDisabledEnv(),
    ...(stdin === undefined ? {} : { stdin })
  }
}

/**
 * Hashes HEAD plus the full working-tree content, tracked and untracked.
 *
 * Every part covers a hole in the others: HEAD alone misses an agent that edits without
 * committing, `status --porcelain` alone repeats byte-for-byte while an agent edits a file
 * already marked `M`, `diff HEAD` excludes untracked files entirely, and the untracked blob
 * hashes are the only thing that moves while an agent iterates on a brand-new file.
 */
export async function readWorktreeProgressFingerprint(
  exec: WorktreeProgressGitExec
): Promise<WorktreeProgressProbeResult> {
  const status = await tryExec(exec, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status === null) {
    return { kind: 'unreadable' }
  }

  const untracked = await readUntrackedContentDigest(exec)
  if (untracked === null) {
    return { kind: 'unreadable' }
  }

  const head = await tryExec(exec, ['rev-parse', '--verify', 'HEAD'])
  const diff = head === null ? null : await tryExec(exec, ['diff', 'HEAD'])
  if (head === null) {
    // A failed HEAD only licenses a missing diff when the branch is provably unborn:
    // `symbolic-ref` still answers there, while a spawn or transport failure kills both.
    if ((await tryExec(exec, ['symbolic-ref', '-q', 'HEAD'])) === null) {
      return { kind: 'unreadable' }
    }
  } else if (diff === null) {
    return { kind: 'unreadable' }
  }

  const digest = createHash('sha256')
    .update(head ?? '')
    .update(' ')
    .update(status)
    .update(' ')
    .update(diff ?? '')
    .update(' ')
    .update(untracked)
    .digest('hex')
  return { kind: 'fingerprint', value: digest }
}

/** Blob hashes of untracked files: bounded output, and the only signal that moves when an
 *  agent edits a file git has not been told about yet. */
async function readUntrackedContentDigest(exec: WorktreeProgressGitExec): Promise<string | null> {
  const listed = await tryExec(exec, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (listed === null) {
    return null
  }
  // `--stdin-paths` is newline-delimited, so a path containing one cannot be hashed; its
  // presence still reaches the digest through the porcelain status.
  const paths = listed.split('\0').filter((path) => path.length > 0 && !path.includes('\n'))
  if (paths.length === 0) {
    return ''
  }
  return tryExec(exec, ['hash-object', '--stdin-paths'], { stdin: `${paths.join('\n')}\n` })
}

async function tryExec(
  exec: WorktreeProgressGitExec,
  args: string[],
  options?: { stdin?: string }
): Promise<string | null> {
  try {
    return (await exec(args, options)).stdout
  } catch {
    return null
  }
}
