import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  formatFleet,
  formatPush,
  formatSweep,
  formatWave,
  type GamePushResult,
  type GameSweepResult,
  type GameWaveResult,
  type SweepClose
} from './orchestrator-game-fleet-format'
import { launchGameMember, readCallerGameState } from './orchestrator-game-launch'
import { gameLaunchChoiceOf, parseGameLaunchFlags } from './orchestrator-game-launch-options'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import { formatStop, stopGameMembers } from './orchestrator-game-stop'
import { agentOfRow, recordFreedMember } from './orchestrator-game-history-record'
import {
  gameFleetReportOf,
  gamePushPlanOf,
  gameSweepOf,
  gameWavePlanOf,
  type GameSweepEntry
} from '../../shared/orchestrator-game-fleet-verbs'
import type { RuntimeTerminalSend } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

type WorkerRow = {
  dispatchId: string
  agentTerminalHandle: string | null
  terminalState: string | null
  workerState: string
}

const TICKET = /^[A-Z0-9][A-Z0-9_-]{0,39}$/

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function ticketsOf(flags: Map<string, string | boolean>): string[] {
  const raw = flags.get('tickets')
  const tickets =
    typeof raw === 'string'
      ? raw
          .toUpperCase()
          .split(/[\s,]+/)
          .filter(Boolean)
      : []
  const bad = tickets.find((ticket) => !TICKET.test(ticket))
  if (bad) {
    throw new RuntimeClientError('invalid_argument', `${bad} is not a ticket id like CIN-12.`)
  }
  return tickets
}

// Why: a terminal reused across dispatches keeps its released rows; only a live one owns it now.
const liveDispatchOf = (handle: string | null, workers: WorkerRow[]): WorkerRow | undefined =>
  handle === null
    ? undefined
    : workers.findLast(
        (worker) => worker.agentTerminalHandle === handle && worker.terminalState !== 'released'
      )

async function closeFinished(
  client: Client,
  entry: GameSweepEntry,
  workers: WorkerRow[]
): Promise<SweepClose | null> {
  const handle = entry.row.terminalHandle
  if (!handle) {
    return null
  }
  const dispatch = liveDispatchOf(handle, workers)
  try {
    if (dispatch) {
      const { result } = await client.call<{
        dispatchId: string
        state: string
        reason?: string
        recovery?: string
      }>('orchestration.workerRelease', { dispatch: dispatch.dispatchId })
      // Why: an unproven release must never be followed by a guessed terminal close.
      if (result.state === 'release_unknown') {
        process.exitCode = 1
      }
      return {
        via: 'release',
        dispatchId: result.dispatchId,
        state: result.state,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.recovery ? { recovery: result.recovery } : {})
      }
    }
    await client.call('terminal.close', { terminal: handle })
    return { via: 'close', terminal: handle }
  } catch (error) {
    process.exitCode = 1
    return { via: dispatch ? 'release' : 'close', error: errorText(error) }
  }
}

export const ORCHESTRATOR_GAME_FLEET_HANDLERS: Record<string, CommandHandler> = {
  'game fleet': async ({ client, json }) => {
    const response = await readCallerGameState(client)
    printResult({ ...response, result: gameFleetReportOf(response.result) }, json, formatFleet)
  },
  'game wave': async ({ flags, client, cwd, json }) => {
    const tickets = ticketsOf(flags)
    const rawRepo = flags.get('repo')
    const repo = typeof rawRepo === 'string' && rawRepo.trim() !== '' ? rawRepo.trim() : null
    const dryRun = flags.get('dry-run') === true
    const overrides = parseGameLaunchFlags(flags)
    const response = await readCallerGameState(client)
    const state = response.result
    gameLaunchChoiceOf(overrides, state.lead ?? DEFAULT_GAME_LEAD)
    const { cap, free } = gameFleetReportOf(state)
    const wave: GameWaveResult = {
      dryRun,
      cap,
      free,
      ...gameWavePlanOf(state, tickets),
      launched: [],
      failed: []
    }
    const launchedOnAccount = new Map<string, string[]>()
    for (const ticket of dryRun ? [] : wave.launch) {
      try {
        const launched = await launchGameMember({
          client,
          state,
          ticket,
          repo,
          flags,
          cwd,
          overrides,
          launched: launchedOnAccount
        })
        if (launched.accountId) {
          launchedOnAccount.set(launched.accountId, [
            ...(launchedOnAccount.get(launched.accountId) ?? []),
            ticket
          ])
        }
        wave.launched.push(launched)
        if (launched.state !== 'ready') {
          process.exitCode = 1
        }
      } catch (error) {
        wave.failed.push({ ticket, error: errorText(error) })
        process.exitCode = 1
      }
    }
    printResult({ ...response, result: wave }, json, formatWave)
  },
  'game sweep': async ({ flags, client, json }) => {
    const close = flags.get('close') === true
    const response = await readCallerGameState(client)
    const entries = gameSweepOf(response.result)
    const sweep: GameSweepResult = { closed: close, finished: entries }
    if (close && entries.some((entry) => entry.row.terminalHandle)) {
      const { result } = await client.call<{ workers: WorkerRow[] }>('orchestration.workerList', {})
      sweep.finished = []
      for (const entry of entries) {
        const member = agentOfRow(response.result, entry.row)
        const history = member
          ? await recordFreedMember({
              client,
              member,
              freedBy: 'sweep',
              workers: result.workers,
              dispatch: liveDispatchOf(entry.row.terminalHandle, result.workers)
            })
          : null
        sweep.finished.push({
          ...entry,
          ...(history ? { history } : {}),
          closed: await closeFinished(client, entry, result.workers)
        })
      }
    }
    printResult({ ...response, result: sweep }, json, formatSweep)
  },
  'game push': async ({ flags, client, json }) => {
    const dryRun = flags.get('dry-run') === true
    const response = await readCallerGameState(client)
    const push: GamePushResult = { dryRun, members: [] }
    for (const entry of gamePushPlanOf(response.result)) {
      const handle = entry.row.terminalHandle
      if (dryRun || entry.action !== 'push' || !handle) {
        push.members.push({ ...entry, sent: false })
        continue
      }
      try {
        const { result } = await client.call<{ send: RuntimeTerminalSend }>('terminal.send', {
          terminal: handle,
          text: entry.prompt,
          enter: true,
          agentPrompt: true,
          client: { id: 'orca-cli', type: 'desktop' }
        })
        push.members.push({
          ...entry,
          sent: result.send.accepted,
          ...(result.send.refusedReason ? { refusedReason: result.send.refusedReason } : {})
        })
      } catch (error) {
        push.members.push({ ...entry, sent: false, error: errorText(error) })
        process.exitCode = 1
      }
    }
    printResult({ ...response, result: push }, json, formatPush)
  },
  'game stop': async ({ flags, client, json }) => {
    const tickets = ticketsOf(flags)
    const all = flags.get('all') === true
    if (tickets.length === 0 && !all) {
      throw new RuntimeClientError('invalid_argument', 'Name the tickets to stop, or pass --all.')
    }
    const response = await readCallerGameState(client)
    const stop = await stopGameMembers(client, response.result, all ? 'all' : tickets)
    printResult({ ...response, result: stop }, json, formatStop)
  }
}
