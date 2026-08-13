import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../format', () => ({ printResult: vi.fn() }))
vi.mock('../selectors', () => ({ getTerminalHandle: vi.fn() }))

import { ORCHESTRATION_HANDLERS } from './orchestration'
import { printResult } from '../format'
import { DISPATCH_DELIVERY_UNPROVEN_NOTE } from '../../shared/dispatch-delivery-proof'

/**
 * ORCA-208: an unproven delivery has to be visible on the line a coordinator
 * actually reads, not only in `--json`.
 *
 * These run the real handlers and then invoke the formatter `printResult` was
 * handed, so what is asserted is the string a human would see. Asserting the
 * source, or that some field exists in the payload, would pass just as happily
 * while the default output kept saying `[ready]` and nothing else.
 */
function renderHumanLine(): string {
  const formatter = vi.mocked(printResult).mock.calls.at(-1)?.[2] as (value: unknown) => string
  const result = vi.mocked(printResult).mock.calls.at(-1)?.[0] as { result: unknown }
  return formatter(result.result)
}

const invoke = (command: string, flags: Map<string, string | boolean>): Promise<unknown> =>
  ORCHESTRATION_HANDLERS[command]({
    flags,
    client: { call: callMock },
    cwd: '/tmp/repo',
    json: false
  } as never)

describe('unproven dispatch delivery on the human-readable line (ORCA-208)', () => {
  beforeEach(() => {
    callMock.mockReset()
    vi.mocked(printResult).mockReset()
  })

  describe('worker-start', () => {
    const workerStartResult = (dispatchInputState: string) => ({
      result: {
        runId: 'run_1',
        taskId: 'task_1',
        dispatchId: 'ctx_1',
        state: 'ready',
        effects: [
          { kind: 'terminal', role: 'agent', action: 'created', id: 'term_worker' },
          { kind: 'dispatch_input', role: 'agent', id: 'term_worker', state: dispatchInputState }
        ],
        residualResources: []
      }
    })

    it('says the bytes were written and the delivery was not proven', async () => {
      callMock.mockResolvedValue(workerStartResult('written_unproven'))

      await invoke('orchestration worker-start', new Map([['task', 'task_1']]))

      const line = renderHumanLine()
      expect(line).toContain(DISPATCH_DELIVERY_UNPROVEN_NOTE)
      // Why: a coordinator must be able to tell this from a write that failed.
      // Both halves have to be present, in that order.
      expect(line).toMatch(/preamble written,[^\n]*delivery unproven/)
      expect(line).toContain('[ready]')
    })

    it('says nothing extra when the composer was proven ready', async () => {
      callMock.mockResolvedValue(workerStartResult('accepted'))

      await invoke('orchestration worker-start', new Map([['task', 'task_1']]))

      expect(renderHumanLine()).toBe('Worker ctx_1 [ready] for task_1')
    })
  })

  describe('worker-show', () => {
    const workerShowResult = (composerReadyProven: number | null) => ({
      result: {
        dispatch: {
          id: 'ctx_1',
          task_id: 'task_1',
          status: 'dispatched',
          composer_ready_proven: composerReadyProven
        },
        worker: { state: 'ready', stage: 'dispatched', agent_terminal_handle: 'term_worker' }
      }
    })

    it('carries the note for a dispatch recorded unproven', async () => {
      callMock.mockResolvedValue(workerShowResult(0))

      await invoke('orchestration worker-show', new Map([['dispatch', 'ctx_1']]))

      expect(renderHumanLine()).toContain(DISPATCH_DELIVERY_UNPROVEN_NOTE)
    })

    it('stays quiet for a proven dispatch', async () => {
      callMock.mockResolvedValue(workerShowResult(1))

      await invoke('orchestration worker-show', new Map([['dispatch', 'ctx_1']]))

      expect(renderHumanLine()).toBe('ctx_1 task=task_1 [ready] stage=dispatched')
    })

    // Why: the column is null for rows written before it existed, for federated
    // dispatches reconciled elsewhere, and for tracking dispatches that never
    // injected. Printing the note there would be a false alarm on dispatches
    // that were never in question.
    it('stays quiet when readiness was never recorded at all', async () => {
      callMock.mockResolvedValue(workerShowResult(null))

      await invoke('orchestration worker-show', new Map([['dispatch', 'ctx_1']]))

      expect(renderHumanLine()).toBe('ctx_1 task=task_1 [ready] stage=dispatched')
    })
  })

  describe('dispatch-show', () => {
    it('carries the note for a dispatch recorded unproven', async () => {
      callMock.mockResolvedValue({
        result: {
          dispatch: {
            id: 'ctx_1',
            task_id: 'task_1',
            status: 'dispatched',
            composer_ready_proven: 0
          }
        }
      })

      await invoke('orchestration dispatch-show', new Map([['task', 'task_1']]))

      expect(renderHumanLine()).toContain(DISPATCH_DELIVERY_UNPROVEN_NOTE)
    })

    it('stays quiet for a proven dispatch', async () => {
      callMock.mockResolvedValue({
        result: {
          dispatch: {
            id: 'ctx_1',
            task_id: 'task_1',
            status: 'dispatched',
            composer_ready_proven: 1
          }
        }
      })

      await invoke('orchestration dispatch-show', new Map([['task', 'task_1']]))

      expect(renderHumanLine()).toBe('ctx_1 task=task_1 [dispatched]')
    })
  })
})
