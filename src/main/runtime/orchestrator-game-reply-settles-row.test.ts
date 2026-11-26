import { afterEach, describe, expect, it } from 'vitest'
import { createOrchestrationRpcHarness } from './rpc/methods/orchestration-rpc-test-harness'
import type { OrchestrationDb } from './orchestration/db'
import type { RpcContext } from './rpc/core'
import { gameInboxSourceOf } from './orchestrator-game-inbox-source'
import { gameInboxesOf, type GameInboxSummary } from '../../shared/orchestrator-game-inbox'
import { gameInboxThreadsOf } from '../../shared/orchestrator-game-inbox-threads'
import {
  emptyGameLeadAlertMemory,
  gameLeadAlertsOf
} from '../../shared/orchestrator-game-lead-alerts'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'

// Why a real DB and the real reply method (ORCA-1481): the fake-DB tests could not see that a reply
// threads the escalation's own thread id, not the escalation.
describe('a reply settles the exact lead-inbox row it answers', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext
  let runId: string

  afterEach(() => h.cleanup())

  function setupMember(): void {
    const state = h.setup()
    db = state.db
    ctx = state.ctx
    runId = state.activeRunId!
    const task = db.createTask({ spec: 'work', displayName: 'ORCA-9001 work' })
    const started = db.createStartingWorkerDispatch({ taskId: task.id, startOptions: {} })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: 'term_worker'
    })
  }

  const memberMail = (type: 'escalation' | 'decision_gate', subject: string, threadId?: string) =>
    db.insertMessage({ from: 'term_worker', to: `run:${runId}`, subject, type, threadId })

  const reply = (id: string, body: string) =>
    h.call('orchestration.reply', { id, body, from: 'term_coord' }, ctx)

  const source = () =>
    gameInboxSourceOf(db, { handle: 'term_coord', paneKey: h.coordinatorPaneKey })
  const leadWaiting = () =>
    gameInboxesOf(source(), {}).find((inbox) => inbox.key === 'lead')?.waiting ?? []

  // Why an hour on: past the 10 min budget, so a row still waiting alerts.
  const watchLines = () => {
    const inboxes: GameInboxSummary[] = [
      { key: 'lead', unread: 0, last: null, waiting: leadWaiting() }
    ]
    return gameLeadAlertsOf(
      {
        agents: [],
        lead: { ...DEFAULT_GAME_LEAD, cap: 6 },
        project: { reviews: null, todo: null },
        inboxes
      },
      emptyGameLeadAlertMemory(),
      Date.now() + 60 * 60_000
    ).map((alert) => alert.line)
  }

  it('settles an escalation sent in its own thread, in the inbox and the watch', async () => {
    setupMember()
    const dispatch = db.insertMessage({
      from: `run:${runId}`,
      to: 'term_worker',
      subject: 'ORCA-9001',
      type: 'dispatch'
    })
    const escalation = memberMail('escalation', 'Blocked: CI', dispatch.id)
    expect(leadWaiting().map((one) => one.id)).toEqual([escalation.id])
    expect(watchLines()).toEqual([expect.stringContaining(escalation.id)])

    await reply(escalation.id, 'Rerun it')

    expect(leadWaiting()).toEqual([])
    expect(watchLines()).toEqual([])
  })

  it('answers only the gate a reply names in the threads, and leaves the earlier one waiting', async () => {
    setupMember()
    const first = memberMail('decision_gate', 'Which layout?')
    const second = memberMail('decision_gate', 'Which colour?')

    await reply(second.id, 'Blue')

    const threads = gameInboxThreadsOf(source())
    expect(threads.waiting.map((one) => one.id)).toEqual([first.id])
    expect(threads.answered.map((one) => [one.id, one.answer])).toEqual([[second.id, 'Blue']])
    expect(leadWaiting().map((one) => one.id)).toEqual([first.id])
    expect(watchLines()).toEqual([expect.stringContaining(first.id)])
  })

  it("still settles a row from an older build's reply, which names only the thread", () => {
    setupMember()
    const escalation = memberMail('escalation', 'Blocked: CI')
    db.insertMessage({
      from: `run:${runId}`,
      to: 'term_worker',
      subject: 'Re: Blocked: CI',
      threadId: escalation.id
    })

    expect(leadWaiting()).toEqual([])
    expect(gameInboxThreadsOf(source()).waiting).toEqual([])
  })
})
