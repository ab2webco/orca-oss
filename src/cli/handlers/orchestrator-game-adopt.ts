import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { readCallerGameState, setGameAgentDropped } from './orchestrator-game-board-call'
import { resumeAdoptedMember, saveAdoptedMember } from './orchestrator-game-adopt-membership'
import { refuseWhileStopped } from './orchestrator-game-hold'
import { openHostRuntimeClient } from './orchestrator-game-host-client'
import { remoteDispatchIdOf } from '../../shared/orchestrator-game-auto-release'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import type { GameStatePausedMember } from '../../shared/orchestrator-game-adopted-members'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { RuntimeTerminalSummary, RuntimeWorktreePsResult } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

export type GameAdoptResult = {
  name: string
  adopted: boolean
  reused?: true
  /** It was dropped from the fleet, and is back in it. */
  restored?: true
  host?: string
  terminal?: string
  dispatchId?: string
  state?: string
  refusal?: string
}

const FOUND_PREFIX = 'remote-found:'
// Why past the default 200: the agent's worktree may sort after the most recent ones.
const PS_LIMIT = 10_000
// Why: the attach brief must never land in a running turn.
const MID_TURN = new Set(['working', 'blocked', 'waiting'])

export const isGameAgentNamed = (agent: GameAgent, name: string): boolean =>
  ticketOfMember(agent) === name.toUpperCase() ||
  agent.displayName?.toLowerCase() === name.toLowerCase()

// Why the leaf: one pane keeps its leaf id while its tab key form differs between readers.
const samePane = (a: string, b: string): boolean =>
  a === b || (a.includes(':') && a.slice(a.indexOf(':')) === b.slice(b.indexOf(':')))

function hostPaneOf(agent: GameAgent): string | null {
  const environmentId = agent.remote?.environmentId
  const prefix = `${FOUND_PREFIX}${environmentId}:`
  return environmentId && agent.paneKey.startsWith(prefix)
    ? agent.paneKey.slice(prefix.length)
    : null
}

type Seat = { terminal: string; environmentId?: string; host?: string }

// Why the repo id: a local found row may be any project's; only this project's is ever adopted.
export const isSameGameProject = (worktreeId: string, leadWorktreeId: string | null): boolean =>
  leadWorktreeId !== null &&
  getRepoIdFromWorktreeId(worktreeId) === getRepoIdFromWorktreeId(leadWorktreeId)

const MID_TURN_REFUSAL = 'its agent is mid-turn; adopt it at its prompt, or pass --force'

/** A non-lead agent of this project by name: on a paired host (listed per project), or in this repo. */
export const isOurGameAgentNamed = (
  agent: GameAgent,
  name: string,
  leadWorktreeId: string | null
): boolean =>
  !agent.isLeader &&
  agent.worktree !== undefined &&
  (agent.remote !== undefined || isSameGameProject(agent.worktree.id, leadWorktreeId)) &&
  isGameAgentNamed(agent, name)

/** The found agent's terminal on its paired host, read there, or why it cannot be adopted. */
async function hostSeatOf(
  found: {
    hostPane: string
    environmentId: string
    host: string
    worktreeId: string
  },
  name: string,
  force: boolean
): Promise<Seat | GameAdoptResult> {
  const { hostPane, environmentId, host, worktreeId } = found
  const where = await openHostRuntimeClient(environmentId)
  const [terminals, ps, runs] = await Promise.all([
    where.call<{ terminals: RuntimeTerminalSummary[] }>('terminal.list', {
      worktree: `id:${worktreeId}`
    }),
    where.call<RuntimeWorktreePsResult>('worktree.ps', { limit: PS_LIMIT }),
    where.call<{ runs: { coordinator_pane_key: string | null }[] }>('orchestration.runList', {})
  ])
  const refuse = (refusal: string): GameAdoptResult => ({
    name,
    adopted: false,
    host,
    refusal
  })
  if (
    runs.result.runs.some(
      (run) => run.coordinator_pane_key && samePane(run.coordinator_pane_key, hostPane)
    )
  ) {
    return refuse(`it leads a Run on ${host}; a lead is never adopted as a member`)
  }
  const terminal = terminals.result.terminals.find(
    (one) =>
      one.connected &&
      one.liveness === 'running' &&
      samePane(`${one.tabId}:${one.leafId}`, hostPane)
  )
  if (!terminal) {
    return refuse(`its terminal no longer runs on ${host}`)
  }
  const agentState = ps.result.worktrees
    .find((one) => one.worktreeId === worktreeId)
    ?.agents.find((row) => samePane(row.paneKey, hostPane))?.state
  if (!force && agentState && MID_TURN.has(agentState)) {
    return refuse(MID_TURN_REFUSAL)
  }
  return { terminal: terminal.handle, environmentId, host }
}

/** A name no task in the lead's Run has: an adopted agent's mail is filed under its name (ORCA-1141). */
async function freeAdoptedNameOf(client: Client, from: string, name: string): Promise<string> {
  type Listed = { tasks?: { task_title?: string | null; display_name?: string | null }[] }
  const listed = await client
    .call<Listed>('orchestration.taskList', { callerTerminalHandle: from })
    .catch(() => null)
  const taken = new Set(
    (listed?.result?.tasks ?? []).flatMap((task) =>
      [task.task_title, task.display_name].flatMap((one) => (one?.trim() ? [one.trim()] : []))
    )
  )
  let free = name
  for (let n = 2; taken.has(free); n++) {
    free = `${name} ${n}`
  }
  return free
}

/** Gives an agent found on this machine or a paired host a dispatch on its own terminal, so mail reaches it both ways. */
async function adoptAgent(
  client: Client,
  agents: readonly GameAgent[],
  name: string,
  args: {
    force: boolean
    flags: Map<string, string | boolean>
    cwd: string
    leadWorktreeId: string | null
    paused: readonly GameStatePausedMember[]
  }
): Promise<GameAdoptResult> {
  const adopted = agents.find(
    (agent) =>
      agent.isMember && agent.remote && remoteDispatchIdOf(agent) && isGameAgentNamed(agent, name)
  )
  if (adopted) {
    return {
      name,
      adopted: true,
      reused: true,
      host: adopted.remote?.host,
      dispatchId: remoteDispatchIdOf(adopted)!
    }
  }
  // Why a member needs no worktree: one in the lead's own worktree is listed without one (ORCA-1141).
  const ours = (agent: GameAgent): boolean =>
    !agent.remote &&
    ((agent.isMember && !agent.found) ||
      (agent.worktree !== undefined &&
        isSameGameProject(agent.worktree.id, args.leadWorktreeId))) &&
    isGameAgentNamed(agent, name)
  const local = agents.find((agent) => agent.found && agent.terminalHandle && ours(agent))
  const found =
    local ??
    agents.find((agent) => agent.found && hostPaneOf(agent) && isGameAgentNamed(agent, name))
  // Why found first: a member named like it must not hide another agent of that name (ORCA-1141).
  if (
    !found &&
    agents.some((agent) => agent.isMember && !agent.found && !agent.isLeader && ours(agent))
  ) {
    return { name, adopted: true, reused: true }
  }
  const worktreeId = found?.worktree?.id
  const hostPane = found ? hostPaneOf(found) : null
  const environmentId = found?.remote?.environmentId
  if (!found || !worktreeId || (!local && (!hostPane || !environmentId))) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No agent named ${name} runs on this machine or this project's paired hosts; see \`orca game fleet\`. Another project's agents are never listed, so never adopted.`
    )
  }
  const seat: Seat | GameAdoptResult = local?.terminalHandle
    ? !args.force && MID_TURN.has(local.state)
      ? { name, adopted: false, refusal: MID_TURN_REFUSAL }
      : { terminal: local.terminalHandle }
    : await hostSeatOf(
        {
          hostPane: hostPane!,
          environmentId: environmentId!,
          host: found.remote?.host ?? environmentId!,
          worktreeId
        },
        name,
        args.force
      )
  if ('adopted' in seat) {
    return seat
  }
  const from = await resolveCoordinatorTerminalHandle(args.flags, args.cwd, client)
  const saved = local
    ? args.paused.find((one) => one.adoptedPane && samePane(one.adoptedPane, local.paneKey))
    : undefined
  if (saved) {
    return resumeAdoptedMember(client, from, saved, seat.terminal)
  }
  const title =
    ticketOfMember(found) ?? (await freeAdoptedNameOf(client, from, found.displayName ?? name))
  const task = await client.call<{ task: { id: string; run_id?: string } }>(
    'orchestration.taskCreate',
    {
      spec: `You are now a member of this project's lead, for ${title}. Keep working on what you were doing; report to the lead through the Orca commands below.`,
      taskTitle: title,
      callerTerminalHandle: from
    }
  )
  // Why worker-start (--on for a host) with --terminal: the path every paired host already serves, so no wire change.
  const started = await client.call<{ dispatchId: string; state: string }>(
    'orchestration.workerStart',
    {
      task: task.result.task.id,
      ...(seat.environmentId ? { on: seat.environmentId } : {}),
      worktree: `id:${worktreeId}`,
      terminal: seat.terminal,
      displayName: title,
      from,
      devMode: isDevCliInvocation()
    }
  )
  if (local) {
    await saveAdoptedMember(client, {
      name: title,
      runId: task.result.task.run_id,
      taskId: task.result.task.id,
      dispatchId: started.result.dispatchId,
      worktreeId,
      agent: found.agentType,
      state: started.result.state,
      paneKey: local.paneKey
    })
  }
  return {
    name: title,
    adopted: started.result.state === 'ready',
    ...(seat.host ? { host: seat.host } : {}),
    terminal: seat.terminal,
    dispatchId: started.result.dispatchId,
    state: started.result.state
  }
}

export const formatGameAdopt = (result: GameAdoptResult): string =>
  result.refusal
    ? `${result.name} not adopted: ${result.refusal}`
    : result.reused
      ? `${result.name} is already a member on ${result.host ?? 'this machine'}${result.dispatchId ? `: dispatch ${result.dispatchId}` : ''}`
      : `${result.name} adopted on ${result.host ?? 'this machine'} (${result.terminal}): dispatch ${result.dispatchId} [${result.state}]`

export const ORCHESTRATOR_GAME_ADOPT_HANDLERS: Record<string, CommandHandler> = {
  'game adopt': async ({ flags, client, cwd, json }) => {
    const raw = flags.get('name')
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) {
      throw new RuntimeClientError('invalid_argument', 'Name the agent to adopt, like ORCA-915.')
    }
    const response = await readCallerGameState(client)
    refuseWhileStopped(response.result, `adopting ${name}`)
    const leadWorktreeId = response.result.worktree?.id ?? null
    // Why first: a dropped agent stays out of the fleet until it is adopted again (ORCA-943).
    const dropped = response.result.droppedAgents?.find((agent) =>
      isOurGameAgentNamed(agent, name, leadWorktreeId)
    )
    if (dropped) {
      await setGameAgentDropped(client, dropped, name, false)
    }
    const agents = dropped ? [...response.result.agents, dropped] : response.result.agents
    const adopted = await adoptAgent(client, agents, name, {
      force: flags.get('force') === true,
      flags,
      cwd,
      leadWorktreeId,
      paused: response.result.pausedMembers ?? []
    })
    const result = dropped ? { ...adopted, restored: true as const } : adopted
    if (!result.adopted) {
      process.exitCode = 1
    }
    printResult({ ...response, result }, json, formatGameAdopt)
  }
}
