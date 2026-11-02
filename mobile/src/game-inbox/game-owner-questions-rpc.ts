import {
  parseGameOwnerQuestionProjects,
  type GameOwnerQuestionProject
} from '../../../src/shared/orchestrator-game-owner-questions'
import type { RpcClient } from '../transport/rpc-client'

export type HostOwnerQuestions =
  | { status: 'ok'; projects: GameOwnerQuestionProject[] }
  | { status: 'unavailable' }

export type OwnerQuestionReply = { option: number } | { text: string }

// Why forbidden too: a host whose mobile allowlist predates the Inbox refuses before dispatch.
const UNAVAILABLE_CODES = new Set(['method_not_found', 'forbidden'])

/** Throws when the read fails for any reason other than an older host. */
export async function readHostOwnerQuestions(client: RpcClient): Promise<HostOwnerQuestions> {
  const response = await client.sendRequest('game.ownerQuestionsAll', {})
  if (!response.ok) {
    if (UNAVAILABLE_CODES.has(response.error.code)) {
      return { status: 'unavailable' }
    }
    throw new Error(response.error.message)
  }
  return { status: 'ok', projects: parseGameOwnerQuestionProjects(response.result) }
}

export async function answerHostOwnerQuestion(
  client: RpcClient,
  args: { worktreeId: string; id: string; reply: OwnerQuestionReply }
): Promise<void> {
  const answer =
    'option' in args.reply ? { option: args.reply.option } : { text: args.reply.text.trim() }
  if ('text' in answer && answer.text === '') {
    throw new Error('The answer is empty.')
  }
  const response = await client.sendRequest('game.ownerAnswer', {
    worktreeId: args.worktreeId,
    id: args.id,
    ...answer
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

export function openOwnerQuestionCount(projects: readonly GameOwnerQuestionProject[]): number {
  return projects.reduce((sum, project) => sum + project.questions.length, 0)
}

/** The context opens externally only when it is a whole http(s) URL. */
export function ownerQuestionContextLink(context: string | null): string | null {
  const trimmed = context?.trim() ?? ''
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    return null
  }
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}
