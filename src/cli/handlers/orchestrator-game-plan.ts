import type { CommandHandler } from '../dispatch'
import { getRepeatedStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller } from './orchestrator-game-board-call'
import {
  gameEffortPlanText,
  parseGameEffortPlan,
  type GameEffortPlan
} from '../../shared/orchestrator-game-effort-plan'

export type GameEffortPlanResult = { ticket: string; known: boolean; plan: GameEffortPlan | null }

const TICKET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/

export function formatGameEffortPlan(result: GameEffortPlanResult): string {
  if (!result.known) {
    return `No member is saved for ${result.ticket} in this project.`
  }
  if (!result.plan) {
    return `${result.ticket} has no effort plan: it was launched before plans, or not by kind.`
  }
  return `${result.ticket} · ${gameEffortPlanText(result.plan)}`
}

export const ORCHESTRATOR_GAME_PLAN_HANDLERS: Record<string, CommandHandler> = {
  'game plan': async ({ flags, client, json }) => {
    const raw = flags.get('ticket')
    const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (!TICKET.test(ticket)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name the ticket: orca game plan <ticket> [--phase name:model:effort:why ...]'
      )
    }
    const phaseValues = getRepeatedStringFlag(flags, 'phase')
    let phases: GameEffortPlan['phases'] | undefined
    if (phaseValues.length > 0) {
      const parsed = parseGameEffortPlan(phaseValues)
      if (!parsed.ok) {
        throw new RuntimeClientError('invalid_argument', parsed.error)
      }
      phases = parsed.plan.phases
    }
    const response = await callGameBoard<GameEffortPlanResult>(
      client,
      'game.effortPlan',
      { ...gameBoardCaller(), ticket, ...(phases ? { phases } : {}) },
      'effort plans'
    )
    printResult(response, json, formatGameEffortPlan)
  }
}
