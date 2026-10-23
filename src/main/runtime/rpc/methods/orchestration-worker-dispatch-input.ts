import type { OrcaRuntimeService } from '../../orca-runtime'
import { buildDispatchPreamble } from '../../orchestration/preamble'
import { dispatchInputOf } from '../../orchestration/dispatch-brief-delivery'
import { getSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import type { WorkerStartInput } from './orchestration-worker-start-schema'

/** What worker-start types into the agent: a game member's one-line brief, or the full preamble. */
export async function workerDispatchInputOf(args: {
  runtime: OrcaRuntimeService
  params: WorkerStartInput
  task: { id: string; spec: string }
  dispatchId: string
  terminalHandle: string
  capability: string
  worktreeId: string
}): Promise<string> {
  const { runtime, params } = args
  const preamble = buildDispatchPreamble({
    taskId: args.task.id,
    dispatchId: args.dispatchId,
    taskSpec: args.task.spec,
    coordinatorHandle: params.from,
    workerHandle: args.terminalHandle,
    dispatchCapability: args.capability,
    devMode: params.devMode,
    cliCommand: runtime.getTerminalOrchestrationCliCommand(args.terminalHandle)
  })
  // Why only a game member in a terminal Orca started: the line names a path relative to that cwd.
  if (!params.game || params.terminal) {
    return preamble
  }
  const input = await dispatchInputOf({
    preamble,
    dispatchId: args.dispatchId,
    taskId: args.task.id,
    target: await runtime.gameMemberBriefTargetFor(args.worktreeId),
    sshHostOf: (connectionId) => getSshFilesystemProvider(connectionId) ?? null
  })
  return input.text
}
