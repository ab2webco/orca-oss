import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { readCallerGameState } from './orchestrator-game-board-call'
import { refuseWhileStopped } from './orchestrator-game-hold'
import { openHostRuntimeClient } from './orchestrator-game-host-client'
import { remoteDispatchIdOf } from '../../shared/orchestrator-game-auto-release'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import type { RuntimeTerminalSummary, RuntimeWorktreePsResult } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

export type GameAdoptResult = {
  name: string
  adopted: boolean
  reused?: true
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

const named = (agent: GameAgent, name: string): boolean =>
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

/** Gives an agent found on a paired host a dispatch on its own terminal, so mail reaches it both ways. */
async function adoptAgent(
  client: Client,
  agents: readonly GameAgent[],
  name: string,
  args: { force: boolean; flags: Map<string, string | boolean>; cwd: string }
): Promise<GameAdoptResult> {
  const adopted = agents.find(
    (agent) => agent.isMember && agent.remote && remoteDispatchIdOf(agent) && named(agent, name)
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
  const found = agents.find((agent) => agent.found && hostPaneOf(agent) && named(agent, name))
  const hostPane = found ? hostPaneOf(found) : null
  const environmentId = found?.remote?.environmentId
  const worktreeId = found?.worktree?.id
  if (!found || !hostPane || !environmentId || !worktreeId) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No agent named ${name} runs on this project's paired hosts; see \`orca game fleet\`. Another project's agents are never listed, so never adopted.`
    )
  }
  const host = found.remote?.host ?? environmentId
  const where = await openHostRuntimeClient(environmentId)
  const [terminals, ps, runs] = await Promise.all([
    where.call<{ terminals: RuntimeTerminalSummary[] }>('terminal.list', {
      worktree: `id:${worktreeId}`
    }),
    where.call<RuntimeWorktreePsResult>('worktree.ps', { limit: PS_LIMIT }),
    where.call<{ runs: { coordinator_pane_key: string | null }[] }>('orchestration.runList', {})
  ])
  const refuse = (refusal: string): GameAdoptResult => ({ name, adopted: false, host, refusal })
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
  if (!args.force && agentState && MID_TURN.has(agentState)) {
    return refuse('its agent is mid-turn; adopt it at its prompt, or pass --force')
  }
  const from = await resolveCoordinatorTerminalHandle(args.flags, args.cwd, client)
  const title = ticketOfMember(found) ?? found.displayName ?? name
  const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    spec: `You are now a member of this project's lead, for ${title}. Keep working on what you were doing; report to the lead through the Orca commands below.`,
    taskTitle: title,
    callerTerminalHandle: from
  })
  // Why worker-start --on with --terminal: the path every paired host already serves, so no wire change.
  const started = await client.call<{ dispatchId: string; state: string }>(
    'orchestration.workerStart',
    {
      task: task.result.task.id,
      on: environmentId,
      worktree: `id:${worktreeId}`,
      terminal: terminal.handle,
      displayName: title,
      from,
      devMode: isDevCliInvocation()
    }
  )
  return {
    name,
    adopted: started.result.state === 'ready',
    host,
    terminal: terminal.handle,
    dispatchId: started.result.dispatchId,
    state: started.result.state
  }
}

export const formatGameAdopt = (result: GameAdoptResult): string =>
  result.refusal
    ? `${result.name} not adopted: ${result.refusal}`
    : result.reused
      ? `${result.name} is already a member on ${result.host ?? 'its host'}: dispatch ${result.dispatchId}`
      : `${result.name} adopted on ${result.host} (${result.terminal}): dispatch ${result.dispatchId} [${result.state}]`

export const ORCHESTRATOR_GAME_ADOPT_HANDLERS: Record<string, CommandHandler> = {
  'game adopt': async ({ flags, client, cwd, json }) => {
    const raw = flags.get('name')
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) {
      throw new RuntimeClientError('invalid_argument', 'Name the agent to adopt, like ORCA-915.')
    }
    const response = await readCallerGameState(client)
    refuseWhileStopped(response.result, `adopting ${name}`)
    const result = await adoptAgent(client, response.result.agents, name, {
      force: flags.get('force') === true,
      flags,
      cwd
    })
    if (!result.adopted) {
      process.exitCode = 1
    }
    printResult({ ...response, result }, json, formatGameAdopt)
  }
}
