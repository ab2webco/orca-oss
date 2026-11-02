import type { CommandHandler } from '../dispatch'
import { stopOne, type GameStopEntry, type GameStopWorker } from './orchestrator-game-stop'
import type { GameResumedMember } from './orchestrator-game-resumed-member-report'
import type { RuntimeTerminalSend } from '../../shared/runtime-types'
import type { GamePausedMember } from '../../shared/orchestrator-game-member-sessions'

type Client = Parameters<CommandHandler>[0]['client']

/**
 * A member whose terminal is still open is never resumed over (ORCA-754): an unsubmitted brief
 * gets Enter, never re-typed; one that stopped reporting is left for the person to check.
 */
export async function settleOpenTerminal(
  client: Client,
  member: GamePausedMember
): Promise<GameResumedMember | null> {
  if (!member.terminal || member.cause === undefined) {
    return null
  }
  if (member.cause === 'terminal-open') {
    return {
      ticket: member.ticket,
      result: 'skipped',
      reason: `its terminal ${member.terminal} is still open; check it, or \`--discard\` stops it`
    }
  }
  const { result } = await client.call<{ send: RuntimeTerminalSend }>('terminal.send', {
    terminal: member.terminal,
    enter: true,
    client: { id: 'orca-cli', type: 'desktop' }
  })
  return result.send.accepted
    ? { ticket: member.ticket, result: 'submitted', terminal: member.terminal }
    : {
        ticket: member.ticket,
        result: 'failed',
        reason: result.send.refusedReason ?? `${member.terminal} did not take the Enter`
      }
}

/**
 * Stops the agent of each discarded member whose terminal is still open (ORCA-754), so a relaunch
 * never leaves two live members on one ticket. A terminal that is gone has nothing to stop.
 */
export async function stopDiscardedTerminals(
  client: Client,
  discarded: readonly GamePausedMember[]
): Promise<GameStopEntry[]> {
  const open = discarded.flatMap((one) =>
    one.terminal ? [{ ...one, terminal: one.terminal }] : []
  )
  if (open.length === 0) {
    return []
  }
  const { result } = await client.call<{ workers: GameStopWorker[] }>(
    'orchestration.workerList',
    {}
  )
  const stopped: GameStopEntry[] = []
  for (const one of open) {
    const entry = await stopOne(
      client,
      {
        row: { ticket: one.ticket, name: one.name ?? one.ticket, terminalHandle: one.terminal },
        worktreeId: null
      },
      result.workers
    )
    if (entry.outcome === 'failed') {
      process.exitCode = 1
    }
    stopped.push(entry)
  }
  return stopped
}

export const formatStoppedTerminal = (one: GameStopEntry): string =>
  one.outcome === 'failed'
    ? `${one.ticket}: its agent is still running: ${one.reason ?? 'the stop failed'}`
    : `${one.ticket}: stopped its agent${one.closedTerminal ? ` and closed ${one.closedTerminal}` : one.dispatchId ? ` (${one.dispatchId})` : ''}`
