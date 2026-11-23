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
import type {
  GameStewardCache,
  GameStewardDecision
} from '../../shared/orchestrator-game-member-steward'

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

export type GameStewardLogResult = {
  ticket: string
  entries: (GameStewardDecision & { session: string | null })[]
}

const pickText = (pick: { model: string; effort: string | null }): string =>
  pick.effort ? `${pick.model} ${pick.effort}` : pick.model

const cacheText = (cache: GameStewardCache | undefined): string => {
  if (!cache) {
    return ''
  }
  const state = cache.known ? (cache.warm ? 'warm' : 'cold') : 'unread'
  const cost = cache.extraUsd === null ? '' : `, switch $${cache.extraUsd.toFixed(2)}`
  const breakEven = cache.breakEven === null ? '' : `, N* ${cache.breakEven}`
  return ` · cache ${state} ${cache.ttl} ${Math.round(cache.contextTokens / 1000)}k: ${cache.why}${cost}${breakEven}`
}

const turnsText = (left: GameStewardDecision['phaseTurns']): string =>
  left ? ` · left ${left.phase} after ${left.turns} turns` : ''

export function formatGameStewardLog(result: GameStewardLogResult): string {
  if (result.entries.length === 0) {
    return `The Orca steward has logged no decision for ${result.ticket} in this project.`
  }
  return result.entries
    .map((one) => {
      const move = `${pickText(one.from)} → ${pickText(one.to)}`
      const kept = one.applied ? '' : ' (not applied)'
      return `${new Date(one.at).toISOString()} ${one.moment} ${one.phase ?? '-'} ${move}${kept} · ${one.source}: ${one.why}${cacheText(one.cache)}${turnsText(one.phaseTurns)}`
    })
    .join('\n')
}

const ticketFlag = (flags: Map<string, string | boolean>, usage: string): string => {
  const raw = flags.get('ticket')
  const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!TICKET.test(ticket)) {
    throw new RuntimeClientError('invalid_argument', `Name the ticket: ${usage}`)
  }
  return ticket
}

export const ORCHESTRATOR_GAME_PLAN_HANDLERS: Record<string, CommandHandler> = {
  'game steward-log': async ({ flags, client, json }) => {
    const ticket = ticketFlag(flags, 'orca game steward-log <ticket>')
    const response = await callGameBoard<GameStewardLogResult>(
      client,
      'game.stewardLog',
      { ...gameBoardCaller(), ticket },
      'steward logs'
    )
    printResult(response, json, formatGameStewardLog)
  },
  'game plan': async ({ flags, client, json }) => {
    const ticket = ticketFlag(flags, 'orca game plan <ticket> [--phase name:model:effort:why ...]')
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
