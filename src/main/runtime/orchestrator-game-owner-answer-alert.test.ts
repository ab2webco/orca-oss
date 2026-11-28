import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptyGameLeadAlertMemory,
  gameLeadAlertsOf,
  newGameLeadAlertsOf
} from '../../shared/orchestrator-game-lead-alerts'
import type { GameInboxSummary } from '../../shared/orchestrator-game-inbox'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import { OrchestrationDb } from './orchestration/db'
import { GameBoard } from './orchestrator-game-board'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { gameInboxSourceOf } from './orchestrator-game-inbox-source'
import { tellGameLead } from './orchestrator-game-lead-note'
import { GameStopSwitch } from './orchestrator-game-stop-switch'

const LEAD_PANE = 'tab_lead:11111111-1111-4111-8111-111111111111'
const LEAD = { handle: 'term_lead', paneKey: LEAD_PANE }
const LEAD_WATCH_TYPES = ['worker_done', 'escalation', 'question', 'decision_gate'] as const

const dirs: string[] = []
const dbs: OrchestrationDb[] = []

afterEach(() => {
  for (const one of dbs.splice(0)) {
    one.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A lead with a Run, and the person's answer to its question sent the way the Inbox sends it. */
async function answeredLead(questions: string[]) {
  const db = new OrchestrationDb(':memory:')
  dbs.push(db)
  const run = db.createRun({
    objective: 'lead',
    coordinatorHandle: LEAD.handle,
    coordinatorPaneKey: LEAD_PANE
  })
  const dir = mkdtempSync(join(tmpdir(), 'orca-owner-answer-alert-'))
  dirs.push(dir)
  const game = new GameBoard({
    store: new GameHistoryStore(() => dir),
    stops: new GameStopSwitch(() => join(dir, 'stop')),
    projectOf: async () => ({ key: 'repo:r1', isMember: false, memberTicket: null, lead: LEAD }),
    inboxSourceOf: (lead) => gameInboxSourceOf(db, lead),
    tellLead: (lead, note) => tellGameLead(db, vi.fn(), lead, note)
  })
  for (const text of questions) {
    const { question } = await game.askOwner({ ticket: 'orca-1', question: text })
    await game.answerOwner({ worktreeId: 'wt', id: question.id, text: `Yes: ${text}` })
  }
  const answers = db.getAllMessagesForHandle(LEAD.handle).filter((m) => m.from_handle === 'owner')
  return { db, run, game, answers: answers.toReversed() }
}

/** One `game watch --lead` started fresh: what it prints on its first read. */
async function freshWatchLines(game: GameBoard, now: number): Promise<string[]> {
  const inboxes: GameInboxSummary[] = await game.inboxSummary({ terminalHandle: LEAD.handle })
  const state = {
    agents: [],
    lead: DEFAULT_GAME_LEAD,
    project: { reviews: null, todo: null },
    inboxes
  }
  const alerts = gameLeadAlertsOf(state, emptyGameLeadAlertMemory(), now)
  return newGameLeadAlertsOf(alerts, new Set()).map((one) => one.line)
}

const minutesFromNow = (minutes: number): number => Date.now() + minutes * 60_000

// Why (ORCA-1489): a lead on a build without ORCA-1431 saw acked and replied owner answers alert after every restart.
describe("game watch --lead on the person's answers", () => {
  it('alerts an owner answer the lead has neither acked nor replied to', async () => {
    const { game, answers } = await answeredLead(['Ship it?'])

    const lines = await freshWatchLines(game, minutesFromNow(15))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`owner answer unread`)
    expect(lines[0]).toContain(`orca orchestration reply --id ${answers[0]?.id}`)
  })

  it('stops alerting an owner answer once the lead acks its delivery, on every restart', async () => {
    const { db, run, game, answers } = await answeredLead(['Ship it?', 'Queue #817?'])
    const delivery = db.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      terminalHandle: LEAD.handle,
      wakeTypes: [...LEAD_WATCH_TYPES]
    })
    expect(delivery?.messages.map((one) => one.id)).toEqual(answers.map((one) => one.id))

    db.acknowledgeRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      deliveryId: delivery!.delivery.id
    })

    expect(await freshWatchLines(game, minutesFromNow(15))).toEqual([])
    // A watch restarted hours later starts from empty memory and still prints nothing.
    expect(await freshWatchLines(game, minutesFromNow(200))).toEqual([])
  })

  it('stops alerting only the owner answer the lead replied to, on every restart', async () => {
    const { db, game, answers } = await answeredLead(['Ship it?', 'Queue #817?'])
    const [replied, open] = answers
    // What `orchestration reply --id <answer>` writes: the reply to the owner, and the answer read.
    db.insertReplyAndMarkRead(replied!.id, {
      from: LEAD.handle,
      to: replied!.from_handle,
      subject: `Re: ${replied!.subject}`,
      body: 'Recorded on the ticket',
      threadId: replied!.thread_id ?? replied!.id,
      senderPaneKey: LEAD_PANE,
      runId: replied!.run_id ?? undefined,
      replyTo: replied!.id
    })

    for (const now of [minutesFromNow(15), minutesFromNow(200)]) {
      const lines = await freshWatchLines(game, now)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`--id ${open?.id}`)
      expect(lines.join('\n')).not.toContain(replied!.id)
    }
  })
})
