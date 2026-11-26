import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameHistoryStore } from './orchestrator-game-history-store'
import {
  keepRemoteMemberOwnerAnswers,
  OWNER_ANSWER_REFRESH_MS,
  OWNER_ANSWER_STALE_MS,
  readRemoteMemberOwnerAnswer,
  shareOwnerAnswersWithRemoteMember,
  type OwnerAnswerShareMark,
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

const NOW = Date.parse('2026-11-25T18:20:00.000Z')
const fresh = { keptAt: NOW - 1_000, now: NOW }

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

    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_mine', fresh)
    ).resolves.toMatchObject({
      question: question('oq_mine', 'CIN-1', 'Yes')
    })
    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_other', fresh)
    ).rejects.toThrow(/No question oq_other for your ticket reached this host/)
    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_2', 'oq_mine', fresh)
    ).rejects.toThrow(/No question oq_mine/)
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

    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1', fresh)
    ).resolves.toMatchObject({
      question: { answer: { text: 'Yes' } }
    })
  })
})

describe("the lead's host shares a remote member's owner answers before its mail", () => {
  function lead(board: unknown[], fail = false) {
    const clock = { version: 1, now: NOW }
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
      version: () => clock.version,
      now: () => clock.now,
      sent: new Map<string, OwnerAnswerShareMark>()
    }
    return { deps, sent, clock }
  }

  it("sends only the member's ticket, once per change, to the host it runs on", async () => {
    const board = [question('oq_1', 'CIN-1', null), question('oq_2', 'CIN-2', 'No')]
    const { deps, sent, clock } = lead(board)

    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    board[0] = question('oq_1', 'CIN-1', 'Yes')
    clock.version += 1
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

    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1', fresh)
    ).resolves.toMatchObject({
      question: { id: 'oq_1', answer: { text: 'Yes', via: 'inbox' } }
    })
  })

  it('never fails the sync when the member host predates the share, and retries it later', async () => {
    const { deps, clock } = lead([question('oq_1', 'CIN-1', 'Yes')], true)
    const send = vi.spyOn(deps, 'send')

    await expect(shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')).resolves.toBeUndefined()
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    clock.now += 15_000
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')

    expect(send).toHaveBeenCalledTimes(2)
    expect(deps.sent.get('ctx_1')?.signature).toBeNull()
  })
})

describe("a paired host's copy of the owner answers says how current it is (ORCA-1440)", () => {
  async function memberHostWith(answer: string | null) {
    const memberHost = store()
    await keepRemoteMemberOwnerAnswers(memberHost, {
      dispatchId: 'ctx_1',
      ticket: 'CIN-1',
      questions: [question('oq_1', 'CIN-1', answer)]
    })
    return memberHost
  }

  it('says "not answered" only while the lead host keeps sharing, and when it shared', async () => {
    const memberHost = await memberHostWith(null)

    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1', fresh)).resolves.toEqual({
      question: question('oq_1', 'CIN-1', null),
      sharedAt: new Date(fresh.keptAt).toISOString()
    })
  })

  it('cannot confirm an unanswered question once the copy is stale or was never shared since start', async () => {
    const memberHost = await memberHostWith(null)
    const stale = { keptAt: NOW - OWNER_ANSWER_STALE_MS - 1, now: NOW }

    await expect(readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1', stale)).rejects.toThrow(
      /cannot confirm oq_1: your lead's host last shared the person's answers here at 2026-11-25T18:16:59\.999Z, 3 min ago/
    )
    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1', { keptAt: undefined, now: NOW })
    ).rejects.toThrow(/cannot confirm oq_1: your lead's host has not shared .* since it started/)
    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_missing', stale)
    ).rejects.toThrow(/cannot confirm oq_missing/)
  })

  it('still reads an answer from an old copy, since an answer never changes', async () => {
    const memberHost = await memberHostWith('Yes')

    await expect(
      readRemoteMemberOwnerAnswer(memberHost, 'ctx_1', 'oq_1', { keptAt: undefined, now: NOW })
    ).resolves.toMatchObject({ question: { answer: { text: 'Yes' } } })
  })

  it('the lead host shares the same set again every minute, so the copy stays current', async () => {
    const sent: RemoteMemberOwnerAnswers[] = []
    const clock = { now: NOW }
    const deps = {
      memberOf: async () => ({ ticket: 'CIN-1', projectKey: 'repo:r1', environmentId: 'env_m1' }),
      questionsOf: async () => [question('oq_1', 'CIN-1', null)],
      send: async (_env: string, shared: RemoteMemberOwnerAnswers) => {
        sent.push(shared)
      },
      version: () => 7,
      now: () => clock.now,
      sent: new Map<string, OwnerAnswerShareMark>()
    }

    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    clock.now += OWNER_ANSWER_REFRESH_MS - 1
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')
    clock.now += 1
    await shareOwnerAnswersWithRemoteMember(deps, 'ctx_1')

    expect(sent).toHaveLength(2)
  })
})
