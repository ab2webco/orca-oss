import { createHash } from 'node:crypto'
import { gitOptionalLocksDisabledEnv } from './runner'
import type { WorktreeProgressProbeResult } from '../../shared/worktree-progress-probe'

/** A working diff this large is pathological; overflowing reads as unreadable, never as unchanged. */
export const WORKTREE_PROGRESS_MAX_BUFFER = 64 * 1024 * 1024
export const WORKTREE_PROGRESS_TIMEOUT_MS = 20_000

export type WorktreeProgressGitExec = (args: string[]) => Promise<{ stdout: string }>

/**
 * Exec options shared by every local probe call site.
 *
 * `GIT_OPTIONAL_LOCKS=0` keeps the probe from refreshing the index and taking
 * `.git/index.lock` out from under the agent it is watching. `preferWslDirectGit` is what
 * carries that variable into WSL: the login-shell route drops it, since `wsl.exe` imports
 * only what `WSLENV` names.
 */
export function worktreeProgressGitExecOptions(
  cwd: string,
  hostOptions: { wslDistro?: string }
): {
  cwd: string
  wslDistro?: string
  preferWslDirectGit: true
  timeout: number
  maxBuffer: number
  env: NodeJS.ProcessEnv
} {
  return {
    ...hostOptions,
    cwd,
    preferWslDirectGit: true,
    timeout: WORKTREE_PROGRESS_TIMEOUT_MS,
    maxBuffer: WORKTREE_PROGRESS_MAX_BUFFER,
    env: gitOptionalLocksDisabledEnv()
  }
}

/**
 * Hashes HEAD plus the tracked working-tree content.
 *
 * HEAD alone misses an agent that edits without committing, and `status --porcelain` alone
 * repeats byte-for-byte while an agent edits a file already marked `M` — only `diff HEAD`
 * carries that content. Two blind spots are known and deliberate for this slice: the content
 * of an untracked file, and work inside a submodule, both of which leave all three components
 * byte-identical.
 */
export async function readWorktreeProgressFingerprint(
  exec: WorktreeProgressGitExec
): Promise<WorktreeProgressProbeResult> {
  const status = await tryExec(exec, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status === null) {
    return { kind: 'unreadable' }
  }

  const head = await tryExec(exec, ['rev-parse', '--verify', 'HEAD'])
  const diff = head === null ? null : await tryExec(exec, ['diff', 'HEAD'])
  if (head === null) {
    if (!(await isUnbornBranch(exec))) {
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
    .digest('hex')
  return { kind: 'fingerprint', value: digest }
}

/**
 * A missing HEAD only licenses a missing diff on a provably unborn branch. `symbolic-ref`
 * alone does not prove it — it answers for any attached HEAD, born or not; the branch is
 * unborn only when the ref it names also fails to resolve.
 */
async function isUnbornBranch(exec: WorktreeProgressGitExec): Promise<boolean> {
  const ref = (await tryExec(exec, ['symbolic-ref', '-q', 'HEAD']))?.trim()
  if (!ref) {
    return false
  }
  return (await tryExec(exec, ['rev-parse', '--verify', '--quiet', ref])) === null
}

async function tryExec(exec: WorktreeProgressGitExec, args: string[]): Promise<string | null> {
  try {
    return (await exec(args)).stdout
  } catch {
    return null
  }
}
