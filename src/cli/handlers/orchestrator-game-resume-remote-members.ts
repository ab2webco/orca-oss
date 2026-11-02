import type { CommandHandler } from '../dispatch'
import { gameBoardCaller } from './orchestrator-game-board-call'
import type { GameResumedMember } from './orchestrator-game-resumed-member-report'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import type { RuntimeTerminalWake } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

export const ticketOfRemoteMember = (agent: GameAgent): string =>
  ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey

/** Members a paired host's restart slept, or the named ones; they wake on that host (ORCA-915). */
export const asleepOnHostsOf = (agents: readonly GameAgent[], named: readonly string[]) =>
  agents.filter(
    (agent) =>
      agent.remote?.asleep && (named.length === 0 || named.includes(ticketOfRemoteMember(agent)))
  )

/** Wakes a member a paired host's restart slept, in its own pane on that host. */
export async function wakeOnHost(client: Client, agent: GameAgent): Promise<GameResumedMember> {
  const ticket = ticketOfRemoteMember(agent)
  try {
    const { result } = await client.call<{ wake: RuntimeTerminalWake }>('game.memberWake', {
      ...gameBoardCaller(),
      dispatchId: agent.paneKey.slice('remote:'.length)
    })
    const host = `on ${agent.remote?.host ?? 'its host'}`
    return result.wake.handle
      ? { ticket, result: 'woken', terminal: result.wake.handle, note: host }
      : { ticket, result: 'woken', note: `${host}, its agent still starting` }
  } catch (error) {
    process.exitCode = 1
    return {
      ticket,
      result: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
