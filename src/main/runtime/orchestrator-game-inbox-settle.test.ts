import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrchestrationRpcHarness } from './rpc/methods/orchestration-rpc-test-harness'
import type { OrchestrationDb } from './orchestration/db'
import type { RpcContext } from './rpc/core'
import type { GameBoardLead } from './orchestrator-game-board'
import { gameInboxSourceOf } from './orchestrator-game-inbox-source'
import { GameInboxSettler, settleLeadInboxRow } from './orchestrator-game-inbox-settle'
import { tellGameLead } from './orchestrator-game-lead-note'
import { gameInboxesOf } from '../../shared/orchestrator-game-inbox'
import { gameInboxThreadsOf } from '../../shared/orchestrator-game-inbox-threads'
import {
  emptyGameLeadAlertMemory,
  gameLeadAlertsOf
} from '../../shared/orchestrator-game-lead-alerts'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import { ORCHESTRATION_LEGACY_RUN_ID } from '../../shared/orchestration-rpc-contract'

// Why a real DB (ORCA-1482): the legacy Run, the reminted handle and the Run mailbox are DB facts
// a fake source would only restate.
describe('the lead settles what no reply can settle', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext
  let runId: string
  let lead: GameBoardLead

  afterEach(() => h.cleanup())

  function setupMember(leadHandle = 'term_coord'): void {
    const state = h.setup()
    db = state.db
    ctx = state.ctx
    runId = state.activeRunId!
    lead = { handle: leadHandle, paneKey: h.coordinatorPaneKey }
    const task = db.createTask({ spec: 'work', displayName: 'ORCA-9001 work' })
    const started = db.createStartingWorkerDispatch({ taskId: task.id, startOptions: {} })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: 'term_worker'
    })
  }

  const source = () => gameInboxSourceOf(db, lead)
  const leadInbox = () => gameInboxesOf(source(), {}).find((inbox) => inbox.key === 'lead')!

  // Why an hour on: past the 10 min budget, so a row still waiting alerts.
  const watchLines = () =>
    gameLeadAlertsOf(
      {
        agents: [],
        lead: { ...DEFAULT_GAME_LEAD, cap: 6 },
        project: { reviews: null, todo: null },
        inboxes: [{ key: 'lead', unread: 0, last: null, waiting: leadInbox().waiting }]
      },
      emptyGameLeadAlertMemory(),
      Date.now() + 60 * 60_000
    ).map((alert) => alert.line)

  const board = () =>
    new GameInboxSettler({
      projectOf: async () => ({ key: 'repo:r1', isMember: false, memberTicket: null, lead }),
      inboxSourceOf: (one) => gameInboxSourceOf(db, one),
      write: (one, row, settle) => settleLeadInboxRow(db, one, row, settle)
    })

  it('settles a legacy-Run escalation the reply refuses, and the watch stops alerting', async () => {
    setupMember()
    const stuck = db.insertMessage({
      from: 'term_worker',
      to: 'term_coord',
      subject: 'Blocked: CI',
      type: 'escalation',
      runId: ORCHESTRATION_LEGACY_RUN_ID
    })
    await expect(
      h.call('orchestration.reply', { id: stuck.id, body: 'ok', from: 'term_coord' }, ctx)
    ).rejects.toThrow(/inspect-only/)
    expect(leadInbox().waiting).toEqual([expect.objectContaining({ stuck: 'legacy_run' })])
    expect(watchLines()).toEqual([
      expect.stringContaining(`orca game inbox --settle ${stuck.id} --note`)
    ])
    expect(gameInboxThreadsOf(source()).waiting).toEqual([
      expect.objectContaining({ id: stuck.id, kind: 'escalation', stuck: 'legacy_run' })
    ])

    const result = await board().settle({
      id: stuck.id,
      note: 'Recorded on ORCA-9001',
      via: 'cli'
    })

    expect(result.settled).toEqual({ id: stuck.id, subject: 'Blocked: CI', stuck: 'legacy_run' })
    expect(leadInbox().waiting).toEqual([])
    expect(watchLines()).toEqual([])
    expect(gameInboxThreadsOf(source()).waiting).toEqual([])
    const note = db.getMessageById(result.noteId)!
    expect(note).toMatchObject({ reply_to: stuck.id, read: 1, delivery_contract: 'audit_only' })
    expect(leadInbox().messages.map((one) => one.body)).toContainEqual(
      `Settled ${stuck.id} without a reply (cli): Recorded on ORCA-9001`
    )
  })

  it("names a reminted lead's mail and a gone sender's, and settles each", async () => {
    setupMember('term_lead_new')
    const toOldHandle = db.insertMessage({
      from: 'term_worker',
      to: 'term_coord',
      subject: 'Which layout?',
      type: 'decision_gate'
    })
    const fromStranger = db.insertMessage({
      from: 'term_stranger',
      to: `run:${runId}`,
      subject: 'Lost member',
      type: 'escalation'
    })
    expect(leadInbox().waiting.map((one) => [one.id, one.stuck])).toEqual([
      [toOldHandle.id, 'reminted_lead'],
      [fromStranger.id, 'gone_sender']
    ])

    await board().settle({ id: toOldHandle.id, note: 'old lead', via: 'inbox' })
    await board().settle({ id: fromStranger.id, note: 'gone', via: 'inbox' })

    expect(leadInbox().waiting).toEqual([])
    expect(watchLines()).toEqual([])
  })

  it("refuses a member's open question and a row that does not wait", async () => {
    setupMember()
    const status = db.insertMessage({ from: 'term_worker', to: `run:${runId}`, subject: 'Hi' })
    await expect(board().settle({ id: status.id, note: 'x', via: 'cli' })).rejects.toThrow(
      /not waiting on the lead/
    )
    vi.spyOn(db, 'listPendingQuestions').mockReturnValue([
      { ...status, id: 'msg_question', type: 'question' }
    ])
    await expect(board().settle({ id: 'msg_question', note: 'x', via: 'cli' })).rejects.toThrow(
      /answer it with orca orchestration reply --id msg_question/
    )
  })

  it("sends an owner answer to the lead's Run mailbox, where the lead's reply settles it", async () => {
    setupMember()
    expect(
      tellGameLead(db, () => {}, lead, { subject: 'Owner answer', body: 'Ship it', payload: {} })
    ).toBe(true)
    const [answer] = leadInbox().waiting
    expect(db.getMessageById(answer!.id)?.to_handle).toBe(`run:${runId}`)

    await h.call(
      'orchestration.reply',
      { id: answer!.id, body: 'Recorded', from: 'term_coord' },
      ctx
    )

    expect(leadInbox().waiting).toEqual([])
  })

  it("delivers mail to the lead's own handle after its pane moved tabs", async () => {
    setupMember()
    // Why the same leaf in another tab: the pane key changed, the pane did not.
    vi.mocked(ctx.runtime.getTerminalPaneKey).mockImplementation((handle) =>
      handle === 'term_coord' ? 'tab_moved:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null
    )
    const direct = db.insertMessage({ from: 'term_worker', to: 'term_coord', subject: 'Direct' })

    const checked = (await h.call('orchestration.check', { terminal: 'term_coord' }, ctx)) as {
      messages: { id: string }[]
    }

    expect(checked.messages.map((one) => one.id)).toContain(direct.id)
  })
})
