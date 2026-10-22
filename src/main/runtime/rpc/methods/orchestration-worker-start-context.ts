import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { assertOrchestrationWorktreeCreationSupported } from './orchestration-folder-worktree-placement'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import { prepareLocalWorkerStart } from './orchestration-worker-start-validation'

/** The coordinator's bound Run and the Task it starts; worker-start refuses anything else. */
export function requireWorkerStartTask(params: WorkerStartInput, runtime: OrcaRuntimeService) {
  const db = runtime.getOrchestrationDb()
  const coordinatorPane = runtime.getTerminalPaneKey(params.from)
  const run = coordinatorPane ? db.getCurrentRunForPane(coordinatorPane) : undefined
  if (!run || (params.run && params.run !== run.id)) {
    throw new OrchestrationError(
      'consumer_fenced',
      'worker-start requires the coordinator terminal currently bound to the Task Run.'
    )
  }
  const task = db.getTask(params.task)
  if (!task || task.run_id !== run.id) {
    throw new OrchestrationError(
      'task_not_found',
      `Task ${params.task} was not found in Run ${run.id}.`
    )
  }
  return { db, run, task }
}

/** The agent and, for a new worktree, the coordinator's worktree it is created from. */
export async function resolveLocalWorkerTopology(
  params: WorkerStartInput,
  runtime: OrcaRuntimeService
) {
  const requestedWorktree = params.worktree ?? 'current'
  const createsWorktree = requestedWorktree === 'new-child' || requestedWorktree === 'new-top-level'
  const { agent, launch } = prepareLocalWorkerStart({ params, createsWorktree, runtime })

  const coordinatorTerminal = await runtime.showTerminal(params.from)
  const creationWorktree = createsWorktree
    ? await runtime.showManagedWorktree(`id:${coordinatorTerminal.worktreeId}`)
    : undefined
  if (creationWorktree) {
    await assertOrchestrationWorktreeCreationSupported({
      runtime,
      repoSelector: params.repo ?? creationWorktree.repoId,
      existingPlacement: 'current or an exact existing folder workspace'
    })
  }
  return {
    requestedWorktree,
    createsWorktree,
    agent,
    launch,
    creationWorktree,
    coordinatorWorktreeId: coordinatorTerminal.worktreeId
  }
}

/** The existing worktree a worker runs in, checking an explicit agent terminal belongs to it. */
export async function resolveExistingWorkerWorktree(
  params: WorkerStartInput,
  runtime: OrcaRuntimeService,
  topology: Awaited<ReturnType<typeof resolveLocalWorkerTopology>>
) {
  const resolvedWorktree = topology.creationWorktree
    ? undefined
    : topology.requestedWorktree === 'current'
      ? await runtime.showManagedTerminalWorkspace(`id:${topology.coordinatorWorktreeId}`)
      : await runtime.showManagedTerminalWorkspace(topology.requestedWorktree)
  if (params.terminal) {
    const explicitTerminal = await runtime.showTerminal(params.terminal)
    if (explicitTerminal.worktreeId !== resolvedWorktree?.id) {
      throw new OrchestrationError(
        'terminal_worktree_mismatch',
        `Terminal ${params.terminal} does not belong to worktree ${resolvedWorktree?.id}.`
      )
    }
    if (!(await runtime.isTerminalRunningAgent(params.terminal))) {
      throw new OrchestrationError(
        'agent_unconfigured',
        `Terminal ${params.terminal} is not running a recognized agent.`
      )
    }
  }
  return resolvedWorktree
}
