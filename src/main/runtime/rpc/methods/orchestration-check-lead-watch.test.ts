import { afterEach, describe, expect, it } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'

describe("orchestration.check: the lead's typed watch (ORCA-861)", () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let activeRunId: string | undefined

  afterEach(() => {
    h.cleanup()
  })

  const watch = () =>
    h.call(
      'orchestration.check',
      {
        terminal: 'term_coord',
        wait: true,
        types: 'worker_done,escalation,question,decision_gate',
        timeoutMs: 300
      },
      ctx
    ) as Promise<{ messages: { id: string }[]; timedOut: boolean }>

  it("wakes on another lead's status reply", async () => {
    ;({ db, runtime, ctx, activeRunId } = h.setup(true))
    const otherLead = db.createRun({
      objective: 'CineCo',
      coordinatorHandle: 'term_other_lead',
      coordinatorPaneKey: 'tab_other:leaf_other'
    })
    const waiting = watch()
    const reply = db.insertMessage({
      from: 'term_other_lead',
      to: 'term_coord',
      subject: 'CineCo lead: failures',
      runId: otherLead.id
    })
    runtime.notifyMessageArrived('term_coord', 'status')

    const result = await waiting
    expect(result.timedOut).toBe(false)
    expect(result.messages.map((row) => row.id)).toEqual([reply.id])
  })

  it("stays asleep on a member's status ping", async () => {
    ;({ db, runtime, ctx, activeRunId } = h.setup(true))
    const task = db.createTask({ spec: 'member work', runId: activeRunId })
    db.createDispatchContext(task.id, 'term_worker')
    const waiting = watch()
    db.insertMessage({
      from: 'term_worker',
      to: `run:${activeRunId}`,
      subject: 'Still testing',
      runId: activeRunId
    })
    runtime.notifyMessageArrived(`run:${activeRunId}`, 'status')

    expect((await waiting).timedOut).toBe(true)
  })
})
