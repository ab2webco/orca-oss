import {
  parseGameOwnerQuestionProjects,
  type GameOwnerQuestion,
  type GameOwnerQuestionProject
} from '../../../../shared/orchestrator-game-owner-questions'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-result'

/** One host's open owner questions; `unavailable` is a build without `game.ownerQuestionsAll`. */
export type GameOwnerQuestionHost = {
  /** null is this computer's runtime. */
  environmentId: string | null
  status: 'ok' | 'unavailable'
  projects: GameOwnerQuestionProject[]
}

export type NewGameOwnerQuestion = {
  environmentId: string | null
  project: GameOwnerQuestionProject
  question: GameOwnerQuestion
}

const READ_TIMEOUT_MS = 15_000

/** Throws when the host cannot be reached, so the caller keeps its last read. */
export async function readGameOwnerQuestionsOfHost(
  environmentId: string | null
): Promise<GameOwnerQuestionHost> {
  const target = environmentId
    ? ({ kind: 'environment', environmentId } as const)
    : ({ kind: 'local' } as const)
  try {
    const result = await callRuntimeRpc<unknown>(
      target,
      'game.ownerQuestionsAll',
      {},
      { timeoutMs: READ_TIMEOUT_MS }
    )
    return { environmentId, status: 'ok', projects: parseGameOwnerQuestionProjects(result) }
  } catch (error) {
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      return { environmentId, status: 'unavailable', projects: [] }
    }
    throw error
  }
}

const questionIdsOf = (host: GameOwnerQuestionHost): Set<string> =>
  new Set(host.projects.flatMap((project) => project.questions.map((question) => question.id)))

// Why a host's first read is silent: it holds questions asked before Orca opened, which the count shows.
export function newGameOwnerQuestions(
  before: readonly GameOwnerQuestionHost[],
  after: readonly GameOwnerQuestionHost[]
): NewGameOwnerQuestion[] {
  return after.flatMap((host) => {
    const previous = before.find((one) => one.environmentId === host.environmentId)
    if (!previous || previous.status !== 'ok') {
      return []
    }
    const seen = questionIdsOf(previous)
    return host.projects.flatMap((project) =>
      project.questions
        .filter((question) => !seen.has(question.id))
        .map((question) => ({ environmentId: host.environmentId, project, question }))
    )
  })
}

export function openGameOwnerQuestionCount(hosts: readonly GameOwnerQuestionHost[]): number {
  return hosts.reduce(
    (sum, host) =>
      sum + host.projects.reduce((inHost, project) => inHost + project.questions.length, 0),
    0
  )
}
