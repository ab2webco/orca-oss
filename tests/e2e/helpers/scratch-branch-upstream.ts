import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function hasOriginRemote(cwd: string): boolean {
  // Why: check presence instead of swallowing errors, so real Git failures still surface.
  return execFileSync('git', ['remote'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
    .split('\n')
    .map((line) => line.trim())
    .includes('origin')
}

function hasUpstream(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      cwd,
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}

/**
 * Why: the Checks panel resolves the branch's upstream from its own Git probe,
 * not from `remoteStatusesByWorktree`, so seeding the store leaves a worktree
 * with no remote rendering "No upstream configured" and the create composer
 * never opens — the Generate button then reads as missing rather than as an
 * unmet precondition. Publishing the branch to a throwaway bare remote makes
 * the precondition real for whatever the panel probes.
 *
 * Returns the cleanup, which the caller must register: leaving `origin` or a
 * dangling upstream behind would leak into every sibling spec that shares this
 * worktree.
 */
export function publishBranchToScratchRemote(worktreePath: string, baseBranch: string): () => void {
  const remoteRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-scratch-remote-'))
  const remotePath = path.join(remoteRoot, 'origin.git')
  execFileSync('git', ['init', '--bare', remotePath], { stdio: 'pipe' })
  if (hasOriginRemote(worktreePath)) {
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: worktreePath, stdio: 'pipe' })
  }
  execFileSync('git', ['remote', 'add', 'origin', remotePath], { cwd: worktreePath, stdio: 'pipe' })
  // Why: PR generation fetches the base ref before it runs, so a remote holding
  // only the feature branch fails with "couldn't find remote ref". Refs are
  // shared across worktrees, so the base can be pushed by name from here.
  execFileSync('git', ['push', 'origin', `refs/heads/${baseBranch}:refs/heads/${baseBranch}`], {
    cwd: worktreePath,
    stdio: 'pipe'
  })
  execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: worktreePath, stdio: 'pipe' })

  return () => {
    if (hasUpstream(worktreePath)) {
      execFileSync('git', ['branch', '--unset-upstream'], { cwd: worktreePath, stdio: 'pipe' })
    }
    if (hasOriginRemote(worktreePath)) {
      execFileSync('git', ['remote', 'remove', 'origin'], { cwd: worktreePath, stdio: 'pipe' })
    }
    rmSync(remoteRoot, { recursive: true, force: true })
  }
}
