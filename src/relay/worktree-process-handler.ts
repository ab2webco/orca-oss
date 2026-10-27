import { listWorktreeProcesses } from '../main/pty/worktree-process-control'
import { RELAY_WORKTREE_PROCESSES_METHOD } from '../shared/worktree-processes'
import type { RelayDispatcher } from './dispatcher'

/** Runs the per-worktree process list/stop on the remote host (ORCA-678), never on the client. */
export class WorktreeProcessHandler {
  constructor(dispatcher: Pick<RelayDispatcher, 'onRequest'>) {
    dispatcher.onRequest(RELAY_WORKTREE_PROCESSES_METHOD, async (params) => {
      const root = params.root
      if (typeof root !== 'string' || root.length === 0) {
        throw new Error('processes.listInRoot requires a root path')
      }
      return await listWorktreeProcesses(root, { stop: params.stop === true })
    })
  }
}
