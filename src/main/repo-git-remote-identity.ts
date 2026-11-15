import {
  deriveGitOwnRemoteKey,
  deriveGitRemoteIdentity,
  type GitRemoteIdentity
} from '../shared/git-remote-identity'
import { gitExecFileAsync } from './git/runner'
import { getSshGitProvider } from './providers/ssh-git-dispatch'

/** `no-remote` means git answered and the repo has no usable remote;
 *  `unavailable` means the probe never reached git (host down, SSH not up
 *  yet, git error) and says nothing about the repo. */
export type GitRemoteIdentityProbe =
  | { status: 'resolved'; identity: GitRemoteIdentity }
  | { status: 'no-remote' }
  | { status: 'unavailable' }

async function gitRemotes(repoPath: string, connectionId?: string | null) {
  return connectionId
    ? await getSshGitProvider(connectionId)?.exec(['remote', '-v'], repoPath)
    : await gitExecFileAsync(['remote', '-v'], { cwd: repoPath })
}

export async function probeGitRemoteIdentity(
  repoPath: string,
  connectionId?: string | null
): Promise<GitRemoteIdentityProbe> {
  try {
    const result = await gitRemotes(repoPath, connectionId)
    if (!result) {
      return { status: 'unavailable' }
    }
    const identity = deriveGitRemoteIdentity(result.stdout)
    return identity ? { status: 'resolved', identity } : { status: 'no-remote' }
  } catch {
    // Repo creation must not fail because a best-effort remote probe failed.
    return { status: 'unavailable' }
  }
}

export async function detectGitRemoteIdentity(
  repoPath: string,
  connectionId?: string | null
): Promise<GitRemoteIdentity | null> {
  const probe = await probeGitRemoteIdentity(repoPath, connectionId)
  return probe.status === 'resolved' ? probe.identity : null
}

/** A fork's own remote, which its identity hides behind `upstream`; null when git cannot answer. */
export async function detectGitOwnRemoteKey(
  repoPath: string,
  connectionId?: string | null
): Promise<string | null> {
  try {
    const result = await gitRemotes(repoPath, connectionId)
    return result ? deriveGitOwnRemoteKey(result.stdout) : null
  } catch {
    return null
  }
}
