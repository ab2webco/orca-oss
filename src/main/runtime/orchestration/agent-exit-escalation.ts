import type { OrchestrationDb } from './db'

export type AgentExit = {
  handle: string
  /** null when the shell reported the agent's command finished without a code. */
  exitCode: number | null
  /** The agent's Claude session, read before its hook authority is retired. */
  sessionId: string | null
}

type ExitDb = Pick<
  OrchestrationDb,
  | 'getActiveDispatchForTerminal'
  | 'failDispatch'
  | 'getRun'
  | 'getActiveCoordinatorRun'
  | 'insertMessage'
>

export const resumeCommandOf = (sessionId: string | null): string | null =>
  sessionId ? `claude --resume ${sessionId}` : null

/** Fails the exited agent's open Dispatch and tells its lead how to resume it; false when it had none. */
export function escalateAgentExit(
  db: ExitDb,
  notify: (handle: string, type: string) => void,
  exit: AgentExit
): boolean {
  const dispatch = db.getActiveDispatchForTerminal(exit.handle)
  if (!dispatch) {
    return false
  }
  const code = exit.exitCode === null ? 'no exit code' : `code ${exit.exitCode}`
  db.failDispatch(dispatch.id, `Agent exited with ${code}`)
  // Why the Dispatch's own Run first (ORCA-989): a game lead has no coordinator_runs row.
  const lead =
    db.getRun(dispatch.run_id)?.coordinator_handle ??
    db.getActiveCoordinatorRun()?.coordinator_handle
  if (!lead) {
    return true
  }
  const resume = resumeCommandOf(exit.sessionId)
  const message = db.insertMessage({
    runId: dispatch.run_id,
    from: exit.handle,
    to: lead,
    subject: `Agent exited unexpectedly (${code})`,
    body: [
      `The agent in ${exit.handle} exited before sending worker_done for ${dispatch.task_id}.`,
      resume
        ? `Resume it in that terminal with: ${resume}`
        : 'Its Claude session id is unknown; relaunch the member.'
    ].join(' '),
    type: 'escalation',
    priority: 'high',
    payload: JSON.stringify({
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      exitCode: exit.exitCode,
      handle: exit.handle,
      resumeCommand: resume
    })
  })
  notify(message.to_handle, message.type)
  return true
}
