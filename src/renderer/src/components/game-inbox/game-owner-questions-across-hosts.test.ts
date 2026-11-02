import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameOwnerQuestionProject } from '../../../../shared/orchestrator-game-owner-questions'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  newGameOwnerQuestions,
  openGameOwnerQuestionCount,
  readGameOwnerQuestionsOfHost,
  type GameOwnerQuestionHost
} from './game-owner-questions-across-hosts'

const callRuntimeRpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc }))

const question = (id: string) => ({
  id,
  ticket: null,
  question: `Question ${id}?`,
  options: [],
  context: null,
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
})

const project = (repoId: string, ids: string[]): GameOwnerQuestionProject => ({
  repoId,
  repoName: repoId,
  worktreeId: `${repoId}::/w`,
  questions: ids.map(question)
})

const host = (
  environmentId: string | null,
  projects: GameOwnerQuestionProject[]
): GameOwnerQuestionHost => ({ environmentId, status: 'ok', projects })

describe('readGameOwnerQuestionsOfHost', () => {
  beforeEach(() => {
    callRuntimeRpc.mockReset()
  })

  it("reads a paired host's projects through its runtime", async () => {
    callRuntimeRpc.mockResolvedValue({ projects: [project('r1', ['oq_1'])] })

    await expect(readGameOwnerQuestionsOfHost('env-imac')).resolves.toEqual(
      host('env-imac', [project('r1', ['oq_1'])])
    )
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-imac' },
      'game.ownerQuestionsAll',
      {},
      expect.anything()
    )
  })

  it('marks a host without the RPC unavailable instead of empty', async () => {
    callRuntimeRpc.mockRejectedValue(
      new RuntimeRpcCallError({
        id: 'r',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method: game.ownerQuestionsAll' }
      } as never)
    )

    await expect(readGameOwnerQuestionsOfHost(null)).resolves.toEqual({
      environmentId: null,
      status: 'unavailable',
      projects: []
    })
  })

  it('lets any other failure through so the last read is kept', async () => {
    callRuntimeRpc.mockRejectedValue(new Error('offline'))

    await expect(readGameOwnerQuestionsOfHost('env-imac')).rejects.toThrow('offline')
  })
})

describe('newGameOwnerQuestions', () => {
  it('names questions that appeared on a host already read, never on a first read', () => {
    const before = [host(null, [project('r1', ['oq_1'])])]
    const after = [
      host(null, [project('r1', ['oq_1', 'oq_2']), project('r2', ['oq_3'])]),
      host('env-imac', [project('r9', ['oq_9'])])
    ]

    expect(
      newGameOwnerQuestions(before, after).map(({ environmentId, project: p, question: q }) => [
        environmentId,
        p.repoId,
        q.id
      ])
    ).toEqual([
      [null, 'r1', 'oq_2'],
      [null, 'r2', 'oq_3']
    ])
  })
})

describe('openGameOwnerQuestionCount', () => {
  it('counts every open question on every host', () => {
    expect(
      openGameOwnerQuestionCount([
        host(null, [project('r1', ['oq_1', 'oq_2'])]),
        host('env-imac', [project('r9', ['oq_9'])]),
        { environmentId: 'env-old', status: 'unavailable', projects: [] }
      ])
    ).toBe(3)
  })
})
