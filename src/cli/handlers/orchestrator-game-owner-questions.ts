import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getRepeatedStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller, optionalText } from './orchestrator-game-board-call'
import type { GameOwnerQuestion } from '../../shared/orchestrator-game-owner-questions'

type AskResult = { question: GameOwnerQuestion }
// Why optional: a host from before ORCA-942 does not send `undelivered`.
type ListResult = {
  questions: GameOwnerQuestion[]
  open: number
  undelivered?: GameOwnerQuestion[]
}
type AnswerResult = { question: GameOwnerQuestion; delivered: boolean; repeated: boolean }

const WHAT = 'owner questions'

function requiredText(flags: Map<string, string | boolean>, name: string): string {
  const value = optionalText(flags, name)
  if (value === undefined) {
    throw new RuntimeClientError('invalid_argument', `Missing required --${name}`)
  }
  return value
}

function formatQuestion(one: GameOwnerQuestion): string[] {
  const head = `${one.id}${one.ticket ? ` ${one.ticket}` : ''} asked ${one.askedAt}: ${one.question}`
  const options = one.options.map((option, index) => `${index + 1}) ${option}`).join('  ')
  return [
    head,
    ...(options ? [`  ${options}`] : []),
    ...(one.context ? [`  ${one.context}`] : []),
    ...(one.answer ? [`  answered ${one.answer.at}: ${one.answer.text}`] : [])
  ]
}

function heldSection(list: GameOwnerQuestion[], tail: [string, string]): string[] {
  if (list.length === 0) {
    return []
  }
  const one = list.length === 1
  return [
    `${list.length} answer${one ? '' : 's'} ${one ? tail[0] : tail[1]}`,
    ...list.flatMap(formatQuestion)
  ]
}

export function formatOwnerQuestions({ questions, open, undelivered = [] }: ListResult): string {
  const head = `${open} open question${open === 1 ? '' : 's'} for the person`
  const sent = undelivered.filter((one) => !one.answer?.undelivered)
  const stuck = undelivered.filter((one) => one.answer?.undelivered)
  return [
    head,
    ...questions.flatMap(formatQuestion),
    ...heldSection(sent, [
      'had not reached you; it is in your mail now:',
      'had not reached you; they are in your mail now:'
    ]),
    ...heldSection(stuck, [
      'could not reach your mail; act on it from here:',
      'could not reach your mail; act on them from here:'
    ])
  ].join('\n')
}

function replyOf(flags: Map<string, string | boolean>): { option: number } | { text: string } {
  const pick = optionalText(flags, 'pick')
  const text = optionalText(flags, 'answer')
  if ((pick === undefined) === (text === undefined)) {
    throw new RuntimeClientError('invalid_argument', 'Give either --pick <n> or --answer <text>.')
  }
  if (pick === undefined) {
    return { text: text as string }
  }
  const option = Number(pick)
  if (!Number.isInteger(option) || option < 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--pick must be an option number, not "${pick}".`
    )
  }
  return { option }
}

export const ORCHESTRATOR_GAME_OWNER_QUESTION_HANDLERS: Record<string, CommandHandler> = {
  'game ask-owner': async ({ flags, client, json }) => {
    const question = requiredText(flags, 'question')
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const context = optionalText(flags, 'context')
    const options = getRepeatedStringFlag(flags, 'option')
    const response = await callGameBoard<AskResult>(
      client,
      'game.ownerAsk',
      {
        ...gameBoardCaller(),
        ...(ticket ? { ticket } : {}),
        question,
        ...(options.length > 0 ? { options } : {}),
        ...(context ? { context } : {})
      },
      WHAT
    )
    printResult(
      response,
      json,
      ({ question: asked }) =>
        `Asked the person ${asked.id}${asked.ticket ? ` (${asked.ticket})` : ''}. Their answer reaches you as an escalation.`
    )
  },
  'game owner-questions': async ({ flags, client, json }) => {
    const response = await callGameBoard<ListResult>(
      client,
      'game.ownerQuestions',
      { ...gameBoardCaller(), ...(flags.get('all') === true ? { all: true } : {}) },
      WHAT
    )
    printResult(response, json, formatOwnerQuestions)
  },
  'game answer-owner': async ({ flags, client, json }) => {
    const id = requiredText(flags, 'id')
    const reply = replyOf(flags)
    const response = await callGameBoard<AnswerResult>(
      client,
      'game.ownerAnswer',
      { ...gameBoardCaller(), id, ...reply },
      WHAT
    )
    printResult(response, json, ({ question, delivered, repeated }) => {
      const told = repeated
        ? 'Already answered; the lead was told then.'
        : delivered
          ? 'The lead was told.'
          : 'The lead could not be told: no lead terminal is known for this project.'
      return `Answered ${question.id}: ${question.answer?.text ?? ''}. ${told}`
    })
  }
}
