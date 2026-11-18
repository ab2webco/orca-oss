import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameHistoryStore } from './orchestrator-game-history-store'
import {
  keepRemoteMemberOwnerAnswers,
  readRemoteMemberOwnerAnswer,
  shareOwnerAnswersWithRemoteMember,
  type RemoteMemberOwnerAnswers
} from './orchestrator-game-member-owner-answer-check'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function store(): GameHistoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'orca-remote-owner-'))
  dirs.push(dir)
  return new GameHistoryStore(() => dir)
}

const question = (id: string, ticket: string | null, answer: string | null) => ({
  id,
  ticket,
  question: 'Merge and deploy?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-18T10:00:00.000Z',
  answer: answer ? { text: answer, at: '2026-11-18T10:05:00.000Z', via: 'inbox' } : null
})

describe("a remote member's host keeps its lead host's owner answers (ORCA-1281)", () => {
  it('reads an answer on its ticket by id, and never one for another ticket', async () => {
    const memberHost = store()
    await keepRemoteMemberOwnerAnswers(memberHost, {
      dispatchId: 'ctx_1',
      ticket: 'CIN-1',
      questions: [question('oq_mine', 'CIN-1', 'Yes'), question('oq_other', 'CIN-2', 'Yes')]
    })

    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_mine')).resolves.toEqual({
      question: question('oq_mine', 'CIN-1', 'Yes')
    })
    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_other')).rejects.toThrow(
      /No question oq_other for your ticket reached this host/
    )
    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_2', 'oq_mine')).rejects.toThrow(
      /No question oq_mine/
    )
  })

  it('replaces what it kept with the newest share, so an answer given later reaches it', async () => {
    const memberHost = store()
    const share = (answer: string | null) =>
      keepRemoteMemberOwnerAnswers(memberHost, {
        dispatchId: 'ctx_1',
        ticket: 'CIN-1',
        questions: [question('oq_1', 'CIN-1', answer)]
      })
    await share(null)
    await share('Yes')

    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1')).resolves.toMatchObject({
      question: { answer: { text: 'Yes' } }
    })
  })
})

describe("the lead's host shares a remote member's owner answers before its mail", () => {
  function lead(board: unknown[], fail = false) {
    const sent: [string, RemoteMemberOwnerAnswers][] = []
    const deps = {
      memberOf: async (dispatchId: string) =>
        dispatchId === 'ctx_1'
          ? { ticket: 'CIN-1', projectKey: 'repo:r1', environmentId: 'env_m2' }
          : null,
      questionsOf: async (key: string) => (key === 'repo:r1' ? board : []),
      send: async (environmentId: string, shared: RemoteMemberOwnerAnswers) => {
        if (fail) {
          throw new Error('Unknown method: game.ownerQuestionsImport')
        }
        sent.push([environmentId, shared])
      },
      sent: new Map<string, string>()
    }
    return { deps, sent }
  }

  it("sends only the member's ticket, once per change, to the host it runs on", async () => {
    const board = [question('oq_1', 'CIN-1', null), question('oq_2', 'CIN-2', 'No')]
    const { deps, sent } = lead(board)

    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    board[0] = question('oq_1', 'CIN-1', 'Yes')
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_other')

    expect(sent.map(([env, shared]) => [env, shared.ticket, shared.questions])).toEqual([
      ['env_m2', 'CIN-1', [question('oq_1', 'CIN-1', null)]],
      ['env_m2', 'CIN-1', [question('oq_1', 'CIN-1', 'Yes')]]
    ])
  })

  it('end to end: what the lead host shares is what the member host reads back', async () => {
    const memberHost = store()
    const { deps } = lead([question('oq_1', 'CIN-1', 'Yes')])
    deps.send = async (_env, shared) => {
      await keepRemoteMemberOwnerAnswers(memberHost, shared)
    }

    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')

    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1')).resolves.toMatchObject({
      question: { id: 'oq_1', answer: { text: 'Yes', via: 'inbox' } }
    })
  })

  it('never fails the mail when the member host predates the share, and retries it next time', async () => {
    const { deps } = lead([question('oq_1', 'CIN-1', 'Yes')], true)

    await expect(shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')).resolves.toBeUndefined()
    expect(deps.sent.size).toBe(0)
  })
})
