import { listWorktreeProcesses } from '../pty/worktree-process-control'
import type {
  WorktreeProcessesOptions,
  WorktreeProcessesResult
} from '../../shared/worktree-processes'
import type { SshGitProvider } from '../providers/ssh-git-provider'

export type WorktreeProcessesTarget = { path: string; connectionId: string | null }

type WorktreeProcessesDeps = {
  getSshGitProvider: (
    connectionId: string
  ) => Pick<SshGitProvider, 'listWorktreeProcesses'> | undefined
  listLocal?: typeof listWorktreeProcesses
}

/** Routes the per-worktree process list/stop to the host that owns the folder (ORCA-678). */
export async function runWorktreeProcesses(
  target: WorktreeProcessesTarget,
  options: WorktreeProcessesOptions,
  deps: WorktreeProcessesDeps
): Promise<WorktreeProcessesResult> {
  if (target.connectionId) {
    const provider = deps.getSshGitProvider(target.connectionId)
    if (!provider) {
      return {
        supported: false,
        root: target.path,
        reason: 'the SSH host is not connected; reconnect it to list its processes'
      }
    }
    // Why: the caller's pid belongs to this machine, so it means nothing on the remote host.
    return await provider.listWorktreeProcesses(target.path, options.stop)
  }
  return await (deps.listLocal ?? listWorktreeProcesses)(target.path, options)
}
