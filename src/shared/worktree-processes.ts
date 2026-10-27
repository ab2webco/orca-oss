/** Relay RPC that lists/stops a worktree's processes on the SSH host (ORCA-678). */
export const RELAY_WORKTREE_PROCESSES_METHOD = 'processes.listInRoot'

export type WorktreeProcessInfo = {
  pid: number
  ppid: number
  command: string
  cwd: string
  startedAt: string
}

export type WorktreeProcessesResult =
  | {
      supported: true
      root: string
      processes: WorktreeProcessInfo[]
      /** Pids sent SIGTERM; survivors get SIGKILL only if pid + lstart + pgid still match. */
      stopped: number[]
      /** Pids that --stop never signals: Orca, the caller, their ancestors, other users. */
      protected: number[]
    }
  | { supported: false; root: string; reason: string }

export type WorktreeProcessesOptions = {
  stop: boolean
  /** The CLI process that asked; it and its shell often have their cwd in the worktree. */
  callerPid?: number
}
