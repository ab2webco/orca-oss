import { describe, expect, it } from 'vitest'
import {
  clearAllListenerCaches,
  clearPaneCacheState,
  createHookListenerState,
  movePaneCacheState,
  normalizeHookPayload,
  type HookListenerState
} from './agent-hook-listener'
import { makePaneKey } from './stable-pane-id'

const SOURCE_PANE = makePaneKey('tab-source', '11111111-1111-4111-8111-111111111111')
const TARGET_PANE = makePaneKey('tab-target', '22222222-2222-4222-8222-222222222222')
// Payload shapes captured from Claude Code 2.1.306: a Monitor's watcher is listed as a plain shell task.
const MONITOR_INPUT = {
  description: 'probe monitor',
  timeout_ms: 300000,
  command: 'sleep 20; echo tick'
}
const MONITOR_TASK = {
  id: 'bdpbe2bri',
  type: 'shell',
  status: 'running',
  description: 'probe monitor',
  command: 'sleep 20; echo tick'
}
const BUILD_SHELL = {
  id: 'b8rs2wmxg',
  type: 'shell',
  status: 'running',
  description: 'Run the build',
  command: 'npm run build'
}

function claudeEvent(state: HookListenerState, paneKey: string, payload: Record<string, unknown>) {
  return normalizeHookPayload(state, 'claude', { paneKey, payload }, 'production')?.payload
}

function armMonitor(state: HookListenerState, paneKey: string, taskId = MONITOR_TASK.id): void {
  claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'watch CI' })
  claudeEvent(state, paneKey, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Monitor',
    tool_input: MONITOR_INPUT
  })
  claudeEvent(state, paneKey, {
    hook_event_name: 'PostToolUse',
    tool_name: 'Monitor',
    tool_input: MONITOR_INPUT,
    tool_response: { taskId, timeoutMs: 300000, persistent: false }
  })
}

describe('Claude Monitor watcher status', () => {
  it('reads idle once the turn ends with only a Monitor armed, and working when its event wakes the agent', () => {
    const state = createHookListenerState()
    armMonitor(state, SOURCE_PANE)

    expect(
      claudeEvent(state, SOURCE_PANE, { hook_event_name: 'Stop', background_tasks: [MONITOR_TASK] })
    ).toMatchObject({ state: 'done' })

    expect(
      claudeEvent(state, SOURCE_PANE, {
        hook_event_name: 'UserPromptSubmit',
        prompt: `<task-notification> <task-id>${MONITOR_TASK.id}</task-id> </task-notification>`
      })?.state
    ).toBe('working')
    expect(
      claudeEvent(state, SOURCE_PANE, { hook_event_name: 'Stop', background_tasks: [MONITOR_TASK] })
        ?.state
    ).toBe('done')
  })

  it('stays working while real background work runs beside the Monitor', () => {
    const state = createHookListenerState()
    armMonitor(state, SOURCE_PANE)

    expect(
      claudeEvent(state, SOURCE_PANE, {
        hook_event_name: 'Stop',
        background_tasks: [MONITOR_TASK, BUILD_SHELL]
      })?.state
    ).toBe('working')
    expect(
      claudeEvent(state, SOURCE_PANE, { hook_event_name: 'Stop', background_tasks: [MONITOR_TASK] })
        ?.state
    ).toBe('done')
  })

  it('does not treat a shell started by another tool as a watcher', () => {
    const state = createHookListenerState()
    armMonitor(state, SOURCE_PANE, 'other-task')

    expect(
      claudeEvent(state, SOURCE_PANE, { hook_event_name: 'Stop', background_tasks: [MONITOR_TASK] })
        ?.state
    ).toBe('working')
  })

  it('forgets a watcher once an inventory no longer lists it running', () => {
    const state = createHookListenerState()
    armMonitor(state, SOURCE_PANE)
    claudeEvent(state, SOURCE_PANE, { hook_event_name: 'Stop', background_tasks: [] })

    expect(state.claudeMonitorTaskIdsByPaneKey.has(SOURCE_PANE)).toBe(false)
  })

  it('keeps the watcher through a pane move and drops it on teardown', () => {
    const state = createHookListenerState()
    armMonitor(state, SOURCE_PANE)
    movePaneCacheState(state, SOURCE_PANE, TARGET_PANE)

    expect(
      claudeEvent(state, TARGET_PANE, { hook_event_name: 'Stop', background_tasks: [MONITOR_TASK] })
        ?.state
    ).toBe('done')

    clearPaneCacheState(state, TARGET_PANE)
    expect(state.claudeMonitorTaskIdsByPaneKey.size).toBe(0)

    armMonitor(state, SOURCE_PANE)
    clearAllListenerCaches(state)
    expect(state.claudeMonitorTaskIdsByPaneKey.size).toBe(0)
  })
})
