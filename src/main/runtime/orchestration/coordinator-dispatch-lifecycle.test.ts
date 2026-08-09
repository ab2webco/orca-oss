import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { Coordinator, type CoordinatorRuntime } from './coordinator'

/**
 * The in-process coordinator loop's dispatch path (ORCA-191 slice 2).
 *
 * Slice 1 left it unmonitored because it minted no capability, and the
 * first-signal deadline is armed only behind a live one. Minting a capability
 * is what closes that gap — and the capability has to travel in the preamble
 * too, or the worker's `worker_done` would be rejected for a dispatch it can no
 * longer settle.
 */
describe('Coordinator dispatch lifecycle (ORCA-191)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  const WORKER = 'term_worker'
  const WORKER_PANE = 'tab_worker:11111111-1111-4111-8111-111111111111'

  type Runtime = CoordinatorRuntime & {
    sent: { handle: string; text: string }[]
    composerReady: { ready: boolean; waitedMs: number }
    turnAccepted: boolean
    authority: {
      paneKey: string | null
      processIncarnation: string | null
      launchTokenHash: string | null
    } | null
    deadlineMonitorStarts: number
  }

  function createRuntime(overrides: Partial<Runtime> = {}): Runtime {
    const runtime: Runtime = {
      sent: [],
      composerReady: { ready: true, waitedMs: 0 },
      turnAccepted: true,
      authority: {
        paneKey: WORKER_PANE,
        processIncarnation: 'runtime_test:pty_1:1',
        launchTokenHash: null
      },
      deadlineMonitorStarts: 0,
      async sendTerminalAgentPrompt(handle: string, prompt: string) {
        runtime.sent.push({ handle, text: prompt })
        return { handle, accepted: true, bytesWritten: 0 }
      },
      async sendTerminalAgentPromptObservingTurn(handle: string, prompt: string) {
        runtime.sent.push({ handle, text: prompt })
        return { turnAcceptance: Promise.resolve({ accepted: runtime.turnAccepted }) }
      },
      async waitForAgentComposerReady() {
        return runtime.composerReady
      },
      getOrchestrationDispatchAuthority() {
        return runtime.authority
      },
      ensureOrchestrationDispatchDeadlineMonitor() {
        runtime.deadlineMonitorStarts += 1
      },
      async listTerminals() {
        return {
          terminals: [{ handle: WORKER, worktreeId: 'wt1', connected: true, writable: true }]
        }
      },
      async createTerminal() {
        return { handle: WORKER, worktreeId: 'wt1' }
      },
      async waitForTerminal(handle: string) {
        return { handle, condition: 'exit' }
      },
      async probeWorktreeDrift() {
        return null
      },
      getTerminalPaneKey() {
        return WORKER_PANE
      },
      ...overrides
    }
    return runtime
  }

  /** Drives one dispatch through the coordinator's private loop entry point. */
  async function dispatchOnce(
    runtime: Runtime,
    d: OrchestrationDb
  ): Promise<{ taskId: string; runId: string }> {
    const run = d.createRun({
      objective: 'coordinator dispatch',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:22222222-2222-4222-8222-222222222222'
    })
    const task = d.createTask({ spec: 'do the work', runId: run.id })
    const coordinator = new Coordinator(d, runtime, {
      spec: 'coordinator dispatch',
      coordinatorHandle: 'term_coord'
    })
    await (
      coordinator as unknown as {
        dispatchTask: (task: unknown, handle: string) => Promise<void>
      }
    ).dispatchTask(task, WORKER)
    return { taskId: task.id, runId: run.id }
  }

  it('mints a capability, puts it in the preamble, and arms the deadline', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRuntime()

    const { taskId } = await dispatchOnce(runtime, db)

    const ctx = db.getDispatchContext(taskId)
    expect(ctx?.capability_hash).not.toBeNull()
    expect(ctx?.monitor_deadline_at).not.toBeNull()
    expect(db.countArmedDispatchDeadlines()).toBe(1)
    expect(runtime.deadlineMonitorStarts).toBe(1)
    // Why: minting without briefing the worker would make every settlement fail
    // with "The Dispatch capability is missing" — a regression, not a fix.
    expect(runtime.sent[0]?.text).toContain('--dispatch-capability dcap_')
  })

  it('leaves a dispatch unmonitored when the pane carries no stable authority', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRuntime({ authority: null })

    const { taskId } = await dispatchOnce(runtime, db)

    const ctx = db.getDispatchContext(taskId)
    // Why: no capability means the worker was never briefed with one, so
    // holding it to a first-signal deadline would fail a healthy dispatch.
    expect(ctx?.capability_hash).toBeNull()
    expect(ctx?.monitor_deadline_at).toBeNull()
    expect(runtime.sent[0]?.text).not.toContain('--dispatch-capability')
  })

  it('skips a dispatch into a TUI that has no composer yet, leaving the task ready', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRuntime({ composerReady: { ready: false, waitedMs: 30_000 } })

    const { taskId } = await dispatchOnce(runtime, db)

    expect(runtime.sent).toHaveLength(0)
    // Why: silent-return like the stale-base guard — failDispatch here would
    // burn circuit-breaker budget for a pane that is merely still booting.
    expect(db.getTask(taskId)?.status).toBe('ready')
    expect(db.getDispatchContext(taskId)).toBeUndefined()
  })

  it('records turn acceptance without disarming the deadline', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRuntime()

    const { taskId } = await dispatchOnce(runtime, db)

    const ctx = db.getDispatchContext(taskId)
    expect(ctx?.turn_accepted_at).not.toBeNull()
    expect(ctx?.first_lifecycle_signal_at).toBeNull()
    expect(db.countArmedDispatchDeadlines()).toBe(1)
  })

  it('still dispatches when the agent never visibly starts a turn', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRuntime({ turnAccepted: false })

    const { taskId } = await dispatchOnce(runtime, db)

    // Why: turn acceptance is advisory. Failing or resending on a miss is the
    // false negative that produced six interleaved pastes into one composer.
    expect(runtime.sent).toHaveLength(1)
    expect(db.getTask(taskId)?.status).toBe('dispatched')
    expect(db.getDispatchContext(taskId)?.turn_accepted_at).toBeNull()
    expect(db.countArmedDispatchDeadlines()).toBe(1)
  })
})
