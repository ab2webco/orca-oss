import { beforeEach, describe, expect, it } from 'vitest'
import { createTestStore } from './store-test-helpers'

const WORKTREE_ID = 'repo1::/repo1/wt'
const TAB_ID = 'tab-1'
const OTHER_TAB_ID = 'tab-2'
const PANE_KEY = `${TAB_ID}:11111111-1111-4111-8111-111111111111`
const OTHER_PANE_KEY = `${OTHER_TAB_ID}:22222222-2222-4222-8222-222222222222`

let store: ReturnType<typeof createTestStore>

beforeEach(() => {
  store = createTestStore()
  store.setState({
    tabsByWorktree: {
      [WORKTREE_ID]: [
        { id: TAB_ID, title: 'Terminal', kind: 'terminal' },
        { id: OTHER_TAB_ID, title: 'Terminal', kind: 'terminal' }
      ]
    }
  } as never)
})

describe('agent stall timer slice', () => {
  it('schedules the first reading one interval out', () => {
    store.getState().setAgentStallTimer(PANE_KEY, 30, 1_000)

    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]).toMatchObject({
      intervalMinutes: 30,
      nextTickAt: 1_000 + 30 * 60_000,
      status: 'watching',
      stalledSince: null
    })
  })

  it('records when the pane went stalled and clears it once progress resumes', () => {
    const state = store.getState()
    state.setAgentStallTimer(PANE_KEY, 15, 0)
    state.seedAgentStallTimerBaseline(PANE_KEY, { kind: 'fingerprint', value: 'a' })

    expect(
      state.applyAgentStallTick(PANE_KEY, { probe: { kind: 'fingerprint', value: 'a' }, now: 500 })
    ).toBe('escalate')
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.stalledSince).toBe(500)

    expect(
      state.applyAgentStallTick(PANE_KEY, { probe: { kind: 'fingerprint', value: 'b' }, now: 900 })
    ).toBe('progressing')
    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.stalledSince).toBeNull()
  })

  it('keeps the arming baseline from being overwritten by a slow reply', () => {
    const state = store.getState()
    state.setAgentStallTimer(PANE_KEY, 15, 0)
    state.seedAgentStallTimerBaseline(PANE_KEY, { kind: 'fingerprint', value: 'first' })
    state.seedAgentStallTimerBaseline(PANE_KEY, { kind: 'fingerprint', value: 'late' })

    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]?.detector.lastFingerprint).toBe(
      'first'
    )
  })

  it('ignores a tick for a pane whose timer was already turned off', () => {
    expect(
      store
        .getState()
        .applyAgentStallTick(PANE_KEY, { probe: { kind: 'fingerprint', value: 'a' }, now: 1 })
    ).toBeNull()
  })

  it('drops a closed tab’s timers so retired pane keys cannot accumulate', () => {
    const state = store.getState()
    state.setAgentStallTimer(PANE_KEY, 15, 0)
    state.setAgentStallTimer(OTHER_PANE_KEY, 15, 0)

    state.clearAgentStallTimersByTabPrefix(TAB_ID)

    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]).toBeUndefined()
    expect(store.getState().agentStallTimerByPaneKey[OTHER_PANE_KEY]).toBeDefined()
  })

  it('drops every timer in a worktree when the worktree goes away', () => {
    const state = store.getState()
    state.setAgentStallTimer(PANE_KEY, 15, 0)
    state.setAgentStallTimer(OTHER_PANE_KEY, 15, 0)

    state.clearAgentStallTimersByWorktree(WORKTREE_ID)

    expect(store.getState().agentStallTimerByPaneKey).toEqual({})
  })
})
