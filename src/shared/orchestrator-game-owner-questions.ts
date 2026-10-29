/** `orca game ask-owner`: what the lead asks the person, kept as records so none is lost in its chat. */

export type GameOwnerAnswer = { text: string; at: string }

export type GameOwnerQuestion = {
  id: string
  ticket: string | null
  question: string
  options: string[]
  /** A link or one line that lets the person answer without the lead's chat. */
  context: string | null
  askedAt: string
  answer: GameOwnerAnswer | null
}

/** What the lead asks; the board stamps id, time and answer. */
export type GameOwnerQuestionDraft = {
  ticket?: string
  question: string
  options?: readonly string[]
  context?: string
}

/** What the person picked: an option by its 1-based number, or free text. */
export type GameOwnerReply = { option?: number; text?: string }

export type GameOwnerAnswerResult<T> =
  | { kind: 'answered'; list: (T | GameOwnerQuestion)[]; question: GameOwnerQuestion }
  | { kind: 'repeated'; question: GameOwnerQuestion }
  | { kind: 'conflict'; question: GameOwnerQuestion }
  | { kind: 'invalid'; reason: string }
  | { kind: 'not_found' }

// Why 200: open questions are never dropped; this bounds the answered ones kept for the audit.
export const GAME_OWNER_QUESTIONS_MAX = 200
export const GAME_OWNER_QUESTION_TEXT_MAX = 2000
export const GAME_OWNER_OPTION_TEXT_MAX = 200
export const GAME_OWNER_OPTIONS_MAX = 6
export const GAME_OWNER_CONTEXT_MAX = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined

function answerOf(value: unknown): GameOwnerAnswer | null | undefined {
  if (value === null) {
    return null
  }
  return isRecord(value) && typeof value.text === 'string' && typeof value.at === 'string'
    ? { text: value.text, at: value.at }
    : undefined
}

export function parseGameOwnerQuestion(raw: unknown): GameOwnerQuestion | null {
  if (!isRecord(raw)) {
    return null
  }
  const { id, question, askedAt, options } = raw
  const ticket = textOrNull(raw.ticket)
  const context = textOrNull(raw.context)
  const answer = answerOf(raw.answer)
  if (
    typeof id !== 'string' ||
    typeof question !== 'string' ||
    typeof askedAt !== 'string' ||
    !Array.isArray(options) ||
    !options.every((one): one is string => typeof one === 'string') ||
    ticket === undefined ||
    context === undefined ||
    answer === undefined
  ) {
    return null
  }
  return { id, ticket, question, options, context, askedAt, answer }
}

const isOpen = (raw: unknown): boolean => parseGameOwnerQuestion(raw)?.answer === null

/** `T` lets the store keep, as they were, the entries a newer build wrote. */
export function addGameOwnerQuestion<T>(
  list: readonly T[],
  question: GameOwnerQuestion
): (T | GameOwnerQuestion)[] {
  const next: (T | GameOwnerQuestion)[] = [...list, question]
  let excess = next.length - GAME_OWNER_QUESTIONS_MAX
  return next.filter((one) => {
    if (excess > 0 && !isOpen(one)) {
      excess -= 1
      return false
    }
    return true
  })
}

function replyText(
  question: GameOwnerQuestion,
  reply: GameOwnerReply
): string | { invalid: string } {
  if (reply.option !== undefined) {
    const picked = question.options[reply.option - 1]
    return picked ?? { invalid: `Option ${reply.option} is not one of ${question.options.length}.` }
  }
  const text = reply.text?.trim() ?? ''
  if (text === '') {
    return { invalid: 'The answer is empty.' }
  }
  return text.length > GAME_OWNER_QUESTION_TEXT_MAX
    ? { invalid: `The answer is over ${GAME_OWNER_QUESTION_TEXT_MAX} characters.` }
    : text
}

export function answerGameOwnerQuestion<T>(
  list: readonly T[],
  id: string,
  reply: GameOwnerReply,
  at: string
): GameOwnerAnswerResult<T> {
  const index = list.findIndex((one) => parseGameOwnerQuestion(one)?.id === id)
  const question = index === -1 ? null : parseGameOwnerQuestion(list[index])
  if (!question) {
    return { kind: 'not_found' }
  }
  const text = replyText(question, reply)
  if (typeof text !== 'string') {
    return { kind: 'invalid', reason: text.invalid }
  }
  if (question.answer) {
    return { kind: question.answer.text === text ? 'repeated' : 'conflict', question }
  }
  const answered: GameOwnerQuestion = { ...question, answer: { text, at } }
  const next: (T | GameOwnerQuestion)[] = [...list]
  next[index] = answered
  return { kind: 'answered', list: next, question: answered }
}

export function openGameOwnerQuestions(list: readonly unknown[]): GameOwnerQuestion[] {
  return list.flatMap((one) => {
    const question = parseGameOwnerQuestion(one)
    return question && question.answer === null ? [question] : []
  })
}

const clipped = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** Throws the reason a draft cannot be kept. */
export function gameOwnerQuestionDraftOf(
  draft: GameOwnerQuestionDraft
): Pick<GameOwnerQuestion, 'ticket' | 'question' | 'options' | 'context'> {
  const question = draft.question.trim()
  const options = (draft.options ?? []).map((one) => one.trim()).filter((one) => one !== '')
  const context = draft.context?.trim() || null
  if (question === '') {
    throw new Error('The question is empty.')
  }
  if (question.length > GAME_OWNER_QUESTION_TEXT_MAX) {
    throw new Error(`The question is over ${GAME_OWNER_QUESTION_TEXT_MAX} characters.`)
  }
  if (options.length > GAME_OWNER_OPTIONS_MAX) {
    throw new Error(`Give at most ${GAME_OWNER_OPTIONS_MAX} options.`)
  }
  if (options.some((one) => one.length > GAME_OWNER_OPTION_TEXT_MAX)) {
    throw new Error(`An option is over ${GAME_OWNER_OPTION_TEXT_MAX} characters.`)
  }
  if (context && context.length > GAME_OWNER_CONTEXT_MAX) {
    throw new Error(`The context is over ${GAME_OWNER_CONTEXT_MAX} characters.`)
  }
  return { ticket: draft.ticket?.trim().toUpperCase() || null, question, options, context }
}

// Why the answer first: the lead's watch and `game inbox` cut long bodies (ORCA-858).
export function gameOwnerAnswerNote(question: GameOwnerQuestion): {
  subject: string
  body: string
  payload: Record<string, unknown>
} {
  const answer = question.answer?.text ?? ''
  const on = question.ticket ? ` ${question.ticket}` : ''
  return {
    subject: `Owner answered${on}: ${clipped(question.question, 80)}`,
    body: [
      `Answer: ${answer}`,
      `Question: ${question.question}`,
      question.ticket ? `Record this answer on ${question.ticket}.` : 'Record this answer.'
    ].join('\n'),
    payload: { ownerQuestionId: question.id, ticket: question.ticket, answer }
  }
}
