import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import { teamCardsOf } from '../../../src/shared/team-panel-member-cards'
import type { TeamTodoTicket } from '../../../src/shared/team-panel-model-types'
import { teamMachinesSectionOf } from '../../../src/shared/team-panel-work-tabs'
import { teamTodoTicketsOf } from '../../../src/shared/team-todo-tickets'

/** `on` is the saved environment `orca game launch --on` takes; null is the lead's own desktop. */
export type AddMemberHost = { on: string | null; running: number; cap: number | null }

export type AddMemberRoster = { todo: TeamTodoTicket[]; hosts: AddMemberHost[] }

/** What the Add member sheet offers, from the same builders the desktop Team panel uses. */
export function addMemberRosterOf(state: OrchestratorGameState): AddMemberRoster {
  const members = teamCardsOf(state, new Set())?.members ?? []
  const machines = teamMachinesSectionOf({ state, members })
  const hosts = (machines?.kind === 'ready' ? machines.value : []).flatMap(
    (one): AddMemberHost[] => {
      const base = { running: one.running, cap: one.cap }
      if (one.host.kind === 'local') {
        return [{ on: null, ...base }]
      }
      return one.host.reachable ? [{ on: one.host.name, ...base }] : []
    }
  )
  return {
    todo: teamTodoTicketsOf(state, members),
    hosts:
      hosts.length > 0
        ? hosts
        : [{ on: null, running: members.length, cap: state.lead?.cap ?? null }]
  }
}
