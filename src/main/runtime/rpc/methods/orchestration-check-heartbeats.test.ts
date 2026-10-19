import { afterEach, describe, expect, it } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'

describe('orchestration.check heartbeats (ORCA-637)', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext
  let activeRunId: string | undefined

  afterEach(() => {
    h.cleanup()
  })

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  it('returns the worker_done, not an unacked heartbeat batch, to --wait --types', async () => {
    ;({ db, ctx, activeRunId } = h.setup(true))
    db.insertMessage({
      from: 'term_worker',
      to: `run:${activeRunId}`,
      subject: 'alive',
      type: 'heartbeat',
      runId: activeRunId
    })
    const plain = (await call('orchestration.check', { terminal: 'term_coord' })) as {
      count: number
    }
    expect(plain.count).toBe(0)

    db.insertMessage({
      from: 'term_worker',
      to: `run:${activeRunId}`,
      subject: 'done',
      type: 'worker_done',
      runId: activeRunId
    })
    const typed = (await call('orchestration.check', {
      terminal: 'term_coord',
      wait: true,
      types: 'worker_done,question,escalation',
      timeoutMs: 10
    })) as { messages: { type: string }[] }

    expect(typed.messages.map((message) => message.type)).toEqual(['worker_done'])
  })

  it('keeps a heartbeat addressed to the coordinator terminal out of the Run batch', async () => {
    ;({ db, ctx, activeRunId } = h.setup(true))
    db.insertMessage({ from: 'term_worker', to: 'term_coord', subject: 'alive', type: 'heartbeat' })
    db.insertMessage({
      from: 'term_worker',
      to: `run:${activeRunId}`,
      subject: 'done',
      type: 'worker_done',
      runId: activeRunId
    })

    const result = (await call('orchestration.check', { terminal: 'term_coord' })) as {
      messages: { type: string }[]
    }

    expect(result.messages.map((message) => message.type)).toEqual(['worker_done'])
  })
})
