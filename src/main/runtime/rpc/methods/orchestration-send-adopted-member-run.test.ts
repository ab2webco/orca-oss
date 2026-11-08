import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_METHODS } from './orchestration'
import { OrchestrationDb } from '../../orchestration/db'
import { OrcaRuntimeService } from '../../orca-runtime'

const LEAD = 'term_lead'
const LEAD_PANE = 'tab_lead:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MAIN = 'term_main'

describe('lead mail to an adopted member while another member made the Run (ORCA-1136)', () => {
  let db: OrchestrationDb

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  async function call(name: string, params: Record<string, unknown>) {
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === LEAD ? LEAD_PANE : null
    )
    vi.spyOn(runtime, 'deliverPendingMessagesForHandle').mockImplementation(() => {})
    const method = ORCHESTRATION_METHODS.find((one) => one.name === name)
    return method!.handler(params as never, { runtime })
  }

  // Why the RPCs: `game launch` and `game adopt` reach the Run the same way, through taskCreate.
  async function adoptAfterQueuedLaunch() {
    db = new OrchestrationDb(':memory:')
    const live1Run = db.createRun({
      objective: 'LIVE-1',
      coordinatorHandle: LEAD,
      coordinatorPaneKey: LEAD_PANE
    })
    await call('orchestration.taskCreate', { spec: 'LIVE-1', callerTerminalHandle: LEAD })
    const adopted = (await call('orchestration.taskCreate', {
      spec: 'You are now a member of this project lead, for main.',
      taskTitle: 'main',
      callerTerminalHandle: LEAD
    })) as { task: { id: string } }
    const dispatch = db.createDispatchContext(adopted.task.id, MAIN)
    return { live1Run, dispatch }
  }

  it.each([
    ['its terminal', () => MAIN],
    ['its dispatch', (id: string) => `dispatch:${id}`]
  ])('files the message to %s under the Run its Dispatch belongs to', async (_, to) => {
    const { live1Run, dispatch } = await adoptAfterQueuedLaunch()

    const sent = (await call('orchestration.send', {
      from: LEAD,
      to: to(dispatch.id),
      subject: 'Reply member ready'
    })) as { message: { run_id: string } }

    expect(dispatch.run_id).toBe(live1Run.id)
    expect(sent.message.run_id).toBe(dispatch.run_id)
  })
})
