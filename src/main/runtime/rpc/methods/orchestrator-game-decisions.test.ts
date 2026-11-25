import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { GameDecisionTrail } from '../../orchestrator-game-decision-trail'
import { GameHistoryStore } from '../../orchestrator-game-history-store'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_DECISION_METHODS } from './orchestrator-game-decisions'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function host() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-decision-rpc-'))
  dirs.push(dir)
  const trail = new GameDecisionTrail({
    store: new GameHistoryStore(() => dir),
    projectOf: async () => ({ key: 'repo:r1', isMember: false, memberTicket: null, lead: null })
  })
  const runtime = {
    getRuntimeId: () => 'runtime',
    getGameDecisions: () => trail
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_DECISION_METHODS })
  return (method: string, params: unknown) =>
    dispatcher.dispatch({ id: 'a', authToken: 'test', method, params })
}

describe('game.decisionAdd, game.decisions and game.decisionDone', () => {
  it('takes a bare decision from an older client and a newer field it does not know', async () => {
    const call = host()
    await expect(
      call('game.decisionAdd', { terminalHandle: 'term_lead', decision: 'Ship it' })
    ).resolves.toMatchObject({ ok: true, result: { decision: { decision: 'Ship it' } } })
    await expect(
      call('game.decisionAdd', { decision: 'Wait', followUp: true, reviewer: 'a later field' })
    ).resolves.toMatchObject({ ok: true, result: { decision: { followUp: { doneAt: null } } } })

    const listed = await call('game.decisions', undefined)
    expect(listed).toMatchObject({
      ok: true,
      result: { total: 1, followUps: [{ decision: 'Wait' }], decisions: [{ decision: 'Ship it' }] }
    })
  })

  it('refuses an empty decision before it reaches the trail', async () => {
    const call = host()
    await expect(call('game.decisionAdd', { decision: '   ' })).resolves.toMatchObject({
      ok: false
    })
    await expect(call('game.decisions', {})).resolves.toMatchObject({
      ok: true,
      result: { total: 0, followUps: [] }
    })
  })

  it('closes a follow-up by id', async () => {
    const call = host()
    const added = (await call('game.decisionAdd', { decision: 'Retry', followUp: true })) as {
      result: { decision: { id: string } }
    }
    await expect(
      call('game.decisionDone', { id: added.result.decision.id })
    ).resolves.toMatchObject({ ok: true, result: { repeated: false } })
  })
})
