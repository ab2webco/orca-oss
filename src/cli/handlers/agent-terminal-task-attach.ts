import type { CommandHandler } from '../dispatch'
import type { RuntimeTerminalWait } from '../../shared/runtime-types'
import { getOptionalPositiveIntegerFlag, getPresentStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'

// Why: matches worker-start's default agent-readiness budget.
const DEFAULT_AGENT_READY_TIMEOUT_MS = 60_000
// Why: the RPC transport must outlive the server-side wait budget.
const WAIT_RPC_TIMEOUT_PADDING_MS = 5_000

export type TaskDispatchReceipt = {
  id: string
  task_id: string
  status: string
}

export type TaskAttachRequest = {
  taskId: string
  from: string
  timeoutMs: number
}

type RuntimeClientParam = Parameters<CommandHandler>[0]['client']

export function getTaskAttachRecoveryCommand(taskId: string, terminalHandle: string): string {
  return `orca orchestration dispatch --task ${taskId} --to ${terminalHandle} --inject --json`
}

export function assertStartupAgentTaskFlagsCompatible(
  flags: Map<string, string | boolean>,
  startupAgent: string | undefined
): void {
  if (!flags.has('task')) {
    return
  }
  if (startupAgent === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--task requires --agent; the dispatch preamble is injected into the startup agent terminal.'
    )
  }
  if (flags.has('prompt')) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--task and --prompt are mutually exclusive; the task spec reaches the agent through the injected dispatch preamble.'
    )
  }
}

export function getStartupAgentTerminalHandleForTask(
  result: {
    worktree: { id: string }
    agentTerminalHandle?: string
    startupTerminal?: { handle?: string }
  },
  taskId: string
): string {
  const handle = result.agentTerminalHandle ?? result.startupTerminal?.handle
  if (handle) {
    return handle
  }
  throw new RuntimeClientError(
    'agent_terminal_unavailable',
    `Worktree ${result.worktree.id} was created but returned no startup agent terminal handle. Find it with \`orca terminal list --worktree id:${result.worktree.id} --json\`, then attach it with: ${getTaskAttachRecoveryCommand(taskId, '<handle>')}`
  )
}

/** Resolves the --task attach context, or undefined when --task was not passed.
 *  Callers must reject incompatible flags (--task without --agent) first. */
export async function resolveTaskAttachRequest(
  flags: Map<string, string | boolean>,
  cwd: string,
  client: RuntimeClientParam
): Promise<TaskAttachRequest | undefined> {
  const taskId = getPresentStringFlag(flags, 'task')
  if (taskId === undefined) {
    return undefined
  }
  // Why: resolve the coordinator identity before creating anything so a caller
  // without a Run-bound terminal fails before an orphan terminal exists.
  return {
    taskId,
    from: await resolveCoordinatorTerminalHandle(flags, cwd, client),
    timeoutMs: getOptionalPositiveIntegerFlag(flags, 'timeout-ms') ?? DEFAULT_AGENT_READY_TIMEOUT_MS
  }
}

export async function attachAgentTerminalToTask(
  client: RuntimeClientParam,
  request: TaskAttachRequest,
  terminalHandle: string
): Promise<TaskDispatchReceipt> {
  try {
    const waited = await client.call<{ wait: RuntimeTerminalWait }>(
      'terminal.wait',
      { terminal: terminalHandle, for: 'tui-idle', timeoutMs: request.timeoutMs },
      { timeoutMs: request.timeoutMs + WAIT_RPC_TIMEOUT_PADDING_MS }
    )
    if (!waited.result.wait.satisfied) {
      const blocked = waited.result.wait.blockedReason
        ? `, blocked: ${waited.result.wait.blockedReason}`
        : ''
      throw new RuntimeClientError(
        'agent_not_ready',
        `Terminal ${terminalHandle} did not reach an idle agent prompt within ${request.timeoutMs}ms (status: ${waited.result.wait.status}${blocked}).`
      )
    }
    const dispatched = await client.call<{ dispatch: TaskDispatchReceipt | null }>(
      'orchestration.dispatch',
      {
        task: request.taskId,
        to: terminalHandle,
        from: request.from,
        inject: true,
        devMode: isDevCliInvocation()
      }
    )
    if (!dispatched.result.dispatch) {
      throw new RuntimeClientError(
        'task_dispatch_failed',
        'The dispatch RPC returned no dispatch receipt.'
      )
    }
    return dispatched.result.dispatch
  } catch (err) {
    // Why: the terminal already exists here; the caller needs the exact command
    // that completes the attach instead of being left with an orphan pane.
    const message = err instanceof Error ? err.message : String(err)
    throw new RuntimeClientError(
      err instanceof RuntimeClientError ? err.code : 'task_dispatch_failed',
      `${message}\nTerminal ${terminalHandle} was created without a task dispatch. Attach it with: ${getTaskAttachRecoveryCommand(request.taskId, terminalHandle)}`,
      err instanceof RuntimeClientError ? err.data : undefined
    )
  }
}
