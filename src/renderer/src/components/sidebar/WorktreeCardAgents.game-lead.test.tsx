import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'

function agent(paneKey: string, terminalHandle: string): DashboardAgentRow {
  return {
    paneKey,
    tab: {
      id: paneKey.split(':')[0],
      ptyId: null,
      title: 'agent',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 1_000,
      worktreeId: 'wt-1'
    },
    entry: {
      paneKey,
      prompt: 'Lead the team',
      agentType: 'claude',
      state: 'working',
      stateStartedAt: 1_000,
      updatedAt: 1_000,
      stateHistory: [],
      terminalHandle
    },
    agentType: 'claude',
    rowSource: 'live',
    state: 'working',
    startedAt: 1_000
  }
}

let agents: DashboardAgentRow[] = []
let displayMode: 'full' | 'compact' = 'full'
let leadHandles: ReadonlySet<string> = new Set()

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      agentActivityDisplayMode: displayMode,
      acknowledgedAgentsByPaneKey: {},
      cacheTimerByKey: {},
      dropAgentStatus: vi.fn(),
      dismissRetainedAgent: vi.fn(),
      agentSendPopoverTargetMode: null,
      agentStatusByPaneKey: {},
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      sendPromptToSidebarAgentTarget: vi.fn(),
      settings: { promptCacheTimerEnabled: false, tabAutoGenerateTitle: false }
    })
}))

vi.mock('@/components/team-panel/game-lead-handles', () => ({
  useGameLeadHandles: () => leadHandles
}))
vi.mock('./useWorktreeAgentRows', () => ({ useWorktreeAgentRows: () => agents }))
vi.mock('@/components/dashboard/useNow', () => ({ useNow: () => 2_000 }))
vi.mock('./focused-agent-row-highlight', () => ({ useFocusedAgentPaneKey: () => null }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: vi.fn() }))
vi.mock('./prompt-cache-countdown-clock', () => ({ usePromptCacheCountdownNow: () => 2_000 }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@/components/dashboard/DashboardAgentRow', () => ({
  default: ({ agent: row, isGameLead }: { agent: DashboardAgentRow; isGameLead?: boolean }) => (
    <div data-pane-key={row.paneKey} data-game-lead={isGameLead ? 'true' : 'false'} />
  )
}))

async function renderAgents(): Promise<string> {
  const { default: WorktreeCardAgents } = await import('./WorktreeCardAgents')
  return renderToStaticMarkup(<WorktreeCardAgents worktreeId="wt-1" />)
}

describe('WorktreeCardAgents game lead crown', () => {
  beforeEach(() => {
    agents = []
    displayMode = 'full'
    leadHandles = new Set(['term-lead'])
  })

  it("crowns only the full row whose terminal is the project's live game lead", async () => {
    agents = [agent('tab-1:1', 'term-lead'), agent('tab-2:1', 'term-other')]

    const markup = await renderAgents()

    expect(markup).toContain('data-pane-key="tab-1:1" data-game-lead="true"')
    expect(markup).toContain('data-pane-key="tab-2:1" data-game-lead="false"')
  })

  // Why one agent: compact mode folds two or more into a summary until the person expands it.
  it('crowns the compact row of the live game lead', async () => {
    displayMode = 'compact'
    agents = [agent('tab-1:1', 'term-lead')]

    expect((await renderAgents()).match(/data-game-lead-crown/g)).toHaveLength(1)
  })

  it('draws no compact crown on an agent that is not a live lead', async () => {
    displayMode = 'compact'
    agents = [agent('tab-1:1', 'term-other')]

    expect(await renderAgents()).not.toContain('data-game-lead-crown')
  })
})
