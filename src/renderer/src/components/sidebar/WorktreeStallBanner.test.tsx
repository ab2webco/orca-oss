// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { WorktreeStallBanner } from './WorktreeStallBanner'

const WORKTREE_ID = 'repo1::/repo1/wt'
const TAB_ID = 'tab-1'
const PANE_KEY = `${TAB_ID}:11111111-1111-4111-8111-111111111111`
const OTHER_PANE_KEY = `${TAB_ID}:22222222-2222-4222-8222-222222222222`
const NEIGHBOUR_WORKTREE_ID = 'repo1::/repo1/neighbour'
const NEIGHBOUR_TAB_ID = 'tab-2'
const NEIGHBOUR_PANE_KEY = `${NEIGHBOUR_TAB_ID}:33333333-3333-4333-8333-333333333333`

let store: ReturnType<typeof createTestStore>

vi.mock('@/store', () => ({
  get useAppStore() {
    return store
  }
}))

function armAndStall(paneKey: string): void {
  const state = store.getState()
  state.setAgentStallTimer(paneKey, 15, 0)
  state.seedAgentStallTimerBaseline(paneKey, { kind: 'fingerprint', value: 'frozen' })
  state.applyAgentStallTick(paneKey, { probe: { kind: 'fingerprint', value: 'frozen' }, now: 1 })
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  store = createTestStore()
  store.setState({
    tabsByWorktree: {
      [WORKTREE_ID]: [{ id: TAB_ID, title: 'Terminal', kind: 'terminal' }],
      [NEIGHBOUR_WORKTREE_ID]: [{ id: NEIGHBOUR_TAB_ID, title: 'Terminal', kind: 'terminal' }]
    }
  } as never)
})

describe('WorktreeStallBanner', () => {
  it('renders nothing while every armed pane keeps moving', () => {
    const state = store.getState()
    state.setAgentStallTimer(PANE_KEY, 15, 0)
    state.seedAgentStallTimerBaseline(PANE_KEY, { kind: 'fingerprint', value: 'a' })
    state.applyAgentStallTick(PANE_KEY, { probe: { kind: 'fingerprint', value: 'b' }, now: 1 })

    const { container } = render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('surfaces a stalled pane even though no agent row exists for it', () => {
    // The dead-pane case: agentStatusByPaneKey is empty, so the agent list renders nothing.
    armAndStall(PANE_KEY)
    expect(store.getState().agentStatusByPaneKey[PANE_KEY]).toBeUndefined()

    render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)

    expect(screen.getByText(/No progress in this workspace since the last check\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop watching' })).toBeTruthy()
    // The alert has to name what it did not measure: a false alarm the user cannot explain
    // costs more trust than the alert buys.
    expect(
      screen.getByText(/the contents of an unadded file, or of a submodule, are not counted yet/)
    ).toBeTruthy()
  })

  it('speaks for the workspace, not per agent, because that is what it measures', () => {
    // One fingerprint covers the whole worktree, so a per-agent count would be a claim the
    // measurement cannot support.
    armAndStall(PANE_KEY)
    armAndStall(OTHER_PANE_KEY)

    render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)

    expect(screen.getAllByText(/No progress in this workspace/)).toHaveLength(1)
    expect(screen.queryByText(/2 agents/)).toBeNull()
  })

  it('stops watching every stalled pane it reports, so the alert can be cleared', () => {
    armAndStall(PANE_KEY)
    armAndStall(OTHER_PANE_KEY)

    const { container } = render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }))

    expect(store.getState().agentStallTimerByPaneKey).toEqual({})
    expect(container).toBeEmptyDOMElement()
  })

  it('offers a disarm for an armed pane whose workspace can no longer be measured', () => {
    // An SSH workspace has no reading to give, and once the agent row is gone the banner is
    // the only surface left that can turn the timer off.
    store.setState({
      repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1', connectionId: 'ssh-1' }]
    } as never)
    store.getState().setAgentStallTimer(PANE_KEY, 15, 0)

    render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }))

    expect(store.getState().agentStallTimerByPaneKey[PANE_KEY]).toBeUndefined()
  })

  it('does not claim a measurement scope on the unmeasurable notice, which measured nothing', () => {
    store.setState({
      repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1', connectionId: 'ssh-1' }]
    } as never)
    store.getState().setAgentStallTimer(PANE_KEY, 15, 0)

    render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)

    expect(screen.queryByText(/the contents of an unadded file/)).toBeNull()
  })

  it('says nothing about a measurable pane that is simply still moving', () => {
    store.setState({
      repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1' }]
    } as never)
    store.getState().setAgentStallTimer(PANE_KEY, 15, 0)

    const { container } = render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not report a stalled pane belonging to another workspace', () => {
    armAndStall(NEIGHBOUR_PANE_KEY)

    const { container } = render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once the reading only failed rather than stalled', () => {
    const state = store.getState()
    state.setAgentStallTimer(PANE_KEY, 15, 0)
    state.seedAgentStallTimerBaseline(PANE_KEY, { kind: 'fingerprint', value: 'a' })
    state.applyAgentStallTick(PANE_KEY, { probe: { kind: 'unreadable' }, now: 1 })

    const { container } = render(<WorktreeStallBanner worktreeId={WORKTREE_ID} />)
    expect(container).toBeEmptyDOMElement()
  })
})
