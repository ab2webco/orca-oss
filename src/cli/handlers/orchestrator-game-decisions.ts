import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller, optionalText } from './orchestrator-game-board-call'
import type { GameDecision, GameDecisionList } from '../../shared/orchestrator-game-decisions'

const WHAT = 'decisions'

function formatRow(one: GameDecision): string[] {
  const done = one.followUp?.doneAt ? ` (follow-up done ${one.followUp.doneAt})` : ''
  return [
    `${one.at} ${one.id}${one.ticket ? ` ${one.ticket}` : ''}: ${one.decision}${done}`,
    ...(one.why ? [`  why: ${one.why}`] : []),
    ...(one.evidence ? [`  evidence: ${one.evidence}`] : [])
  ]
}

export function formatGameDecisions({ followUps, decisions, total }: GameDecisionList): string {
  const pending = followUps.length
  const shown = decisions.length < total ? `latest ${decisions.length} of ${total}` : `${total}`
  return [
    `${pending} pending follow-up${pending === 1 ? '' : 's'}`,
    ...followUps.flatMap(formatRow),
    `${shown} decision${total === 1 ? '' : 's'}, newest first${decisions.length < total ? ' (--all for every one)' : ''}`,
    ...decisions.flatMap(formatRow)
  ].join('\n')
}

function draftOf(flags: Map<string, string | boolean>): { decision: string; followUp?: true } {
  const decision = optionalText(flags, 'decision')
  const followUp = optionalText(flags, 'follow-up')
  if ((decision === undefined) === (followUp === undefined)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Give either --decision <text> or --follow-up <text>.'
    )
  }
  return decision !== undefined ? { decision } : { decision: followUp as string, followUp: true }
}

export const ORCHESTRATOR_GAME_DECISION_HANDLERS: Record<string, CommandHandler> = {
  'game decision add': async ({ flags, client, json }) => {
    const draft = draftOf(flags)
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const why = optionalText(flags, 'why')
    const evidence = optionalText(flags, 'evidence')
    const response = await callGameBoard<{ decision: GameDecision }>(
      client,
      'game.decisionAdd',
      {
        ...gameBoardCaller(),
        ...draft,
        ...(ticket ? { ticket } : {}),
        ...(why ? { why } : {}),
        ...(evidence ? { evidence } : {})
      },
      WHAT
    )
    printResult(response, json, ({ decision }) =>
      [
        `Recorded ${decision.followUp ? 'follow-up' : 'decision'} ${decision.id}${decision.ticket ? ` (${decision.ticket})` : ''}.`,
        ...(decision.followUp ? [`Close it with \`orca game decision done ${decision.id}\`.`] : [])
      ].join(' ')
    )
  },
  'game decision list': async ({ flags, client, json }) => {
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const response = await callGameBoard<GameDecisionList>(
      client,
      'game.decisions',
      {
        ...gameBoardCaller(),
        ...(ticket ? { ticket } : {}),
        ...(flags.get('all') === true ? { all: true } : {})
      },
      WHAT
    )
    printResult(response, json, formatGameDecisions)
  },
  'game decision done': async ({ flags, client, json }) => {
    const id = optionalText(flags, 'id')
    if (id === undefined) {
      throw new RuntimeClientError('invalid_argument', 'Missing required --id')
    }
    const response = await callGameBoard<{ decision: GameDecision; repeated: boolean }>(
      client,
      'game.decisionDone',
      { ...gameBoardCaller(), id },
      WHAT
    )
    printResult(response, json, ({ decision, repeated }) =>
      repeated
        ? `${decision.id} was already done at ${decision.followUp?.doneAt}.`
        : `Done: ${decision.id} ${decision.decision}`
    )
  }
}
