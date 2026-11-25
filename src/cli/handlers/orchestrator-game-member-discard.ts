import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import type { RuntimeRpcSuccess } from '../runtime-client'
import { gameBoardCaller } from './orchestrator-game-board-call'
import {
  formatStoppedTerminal,
  stopDiscardedTerminals
} from './orchestrator-game-open-member-terminal'
import { gameFleetMembersOf, ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

type DiscardState = Pick<
  OrchestratorGameState,
  'agents' | 'pausedMembers' | 'unlistedMembers' | 'pausedMembersError'
>

export type GameDiscardPlan = {
  /** What `game.memberDiscard` is asked to free. */
  tickets: string[] | 'all'
  /** Named tickets a live member holds: its saved record is that member's, so it stays. */
  held: { ticket: string; name: string }[]
}

/**
 * What `resume-members --discard` frees. Why: the runtime drops every saved record of a named
 * ticket, and `all` drops live members' records too, so their next restart cannot resume them (ORCA-1433).
 */
export function gameDiscardPlanOf(state: DiscardState, named: readonly string[]): GameDiscardPlan {
  const live = new Map(
    gameFleetMembersOf(state).flatMap((agent) => {
      const ticket = agent.found ? null : ticketOfMember(agent)
      return ticket ? [[ticket, agent.displayName ?? ticket] as const] : []
    })
  )
  if (named.length > 0) {
    return {
      tickets: named.filter((ticket) => !live.has(ticket)),
      held: named.flatMap((ticket) => {
        const name = live.get(ticket)
        return name ? [{ ticket, name }] : []
      })
    }
  }
  // Why `all` for an unreadable file: only it sets the file aside, kept, so nothing is lost.
  if (live.size === 0 || state.pausedMembersError) {
    return { tickets: 'all', held: [] }
  }
  const saved = [...(state.pausedMembers ?? []), ...(state.unlistedMembers ?? [])]
  return { tickets: [...new Set(saved.map((one) => one.ticket))], held: [] }
}

const heldText = (held: GameDiscardPlan['held']): string =>
  held.length > 0
    ? ` · kept, a live member holds it: ${held.map((one) => `${one.ticket} (${one.name})`).join(', ')}`
    : ''

/** `resume-members --discard [--dry-run]`: frees saved members no live member holds. */
export async function discardGameMembers(
  client: Client,
  response: RuntimeRpcSuccess<DiscardState>,
  args: { named: readonly string[]; dryRun: boolean; json: boolean }
): Promise<void> {
  const state = response.result
  const plan = gameDiscardPlanOf(state, args.named)
  if (args.dryRun) {
    const saved = [...(state.pausedMembers ?? []), ...(state.unlistedMembers ?? [])]
    const wouldFree = plan.tickets === 'all' ? saved.map((one) => one.ticket) : plan.tickets
    const setAside = plan.tickets === 'all' && state.pausedMembersError !== undefined
    printResult(
      { ...response, result: { dryRun: true, wouldFree, held: plan.held, setAside } },
      args.json,
      (result) =>
        result.setAside
          ? 'Would set the unreadable members file aside, kept, and start a new record.'
          : `Would free ${result.wouldFree.length}: ${result.wouldFree.join(', ') || 'none'}${heldText(result.held)}`
    )
    return
  }
  const discarded =
    plan.tickets.length === 0
      ? { ...response, result: { discarded: [] as string[], setAside: null as string | null } }
      : await client.call<{ discarded: string[]; setAside: string | null }>('game.memberDiscard', {
          ...gameBoardCaller(),
          tickets: plan.tickets
        })
  const stopped = await stopDiscardedTerminals(
    client,
    (state.pausedMembers ?? []).filter((one) => discarded.result.discarded.includes(one.ticket))
  )
  printResult(
    { ...response, result: { ...discarded.result, held: plan.held, stopped } },
    args.json,
    (result) =>
      result.setAside
        ? `Set the unreadable members file aside at ${result.setAside}; new members are saved from now on.`
        : [
            `Freed ${result.discarded.length}: ${result.discarded.join(', ') || 'none'}${heldText(result.held)}`,
            ...result.stopped.map(formatStoppedTerminal)
          ].join('\n')
  )
}
