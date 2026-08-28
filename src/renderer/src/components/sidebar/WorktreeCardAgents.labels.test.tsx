import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'

type AgentOptions = {
  paneKey: string
  tabId?: string
  conversationName?: string
  prompt: string
  agentType: string
  lastAssistantMessage?: string
  rowSource?: DashboardAgentRow['rowSource']
  parentPaneKey?: string
  lineage?: DashboardAgentRow['lineage']
}

function agent({
  paneKey,
  tabId = 'tab-1',
  conversationName,
  prompt,
  agentType,
  lastAssistantMessage,
  rowSource = 'live',
  parentPaneKey,
  lineage
}: AgentOptions): DashboardAgentRow {
  return {
    paneKey,
    tab: {
      id: tabId,
      ptyId: null,
      title: 'agent',
      customTitle: conversationName ?? null,
      color: null,
      sortOrder: 0,
      createdAt: 1_000,
      worktreeId: 'wt-1'
    },
    entry: {
      paneKey,
      prompt,
      agentType,
      state: 'working',
      stateStartedAt: 1_000,
      updatedAt: 1_000,
      lastAssistantMessage,
      stateHistory: [],
      orchestration: parentPaneKey
        ? { taskId: 'child-task', dispatchId: 'child-dispatch', parentPaneKey }
        : undefined
    },
    agentType,
    rowSource,
    state: 'working',
    startedAt: 1_000,
    lineage
  }
}

let agents: DashboardAgentRow[] = []
let displayMode: 'full' | 'compact' = 'full'

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
  default: ({ agent, label }: { agent: DashboardAgentRow; label?: string }) => (
    <div data-pane-key={agent.paneKey} data-resolved-label={label} />
  )
}))

async function renderAgents(): Promise<string> {
  const { default: WorktreeCardAgents } = await import('./WorktreeCardAgents')
  return renderToStaticMarkup(<WorktreeCardAgents worktreeId="wt-1" />)
}

describe('WorktreeCardAgents labels', () => {
  beforeEach(() => {
    agents = []
    displayMode = 'full'
  })

  it('does not repeat a resolved compact primary as its secondary', async () => {
    const { CompactAgentRow } = await import('./worktree-card-compact-agents')
    const row = agent({
      paneKey: 'tab-1:1',
      prompt: 'Repeated result',
      agentType: 'claude',
      lastAssistantMessage: 'Repeated result'
    })

    const markup = renderToStaticMarkup(
      <CompactAgentRow agent={row} label="Repeated result" now={2_000} onActivate={vi.fn()} />
    )

    expect(markup).not.toContain(' - Repeated result</span>')
  })

  it('renders a distinct label for every pane when tab and pane titles collide', async () => {
    agents = ['1', '2', '3'].map((leaf) =>
      agent({
        paneKey: `tab-1:${leaf}`,
        conversationName: 'Shared conversation',
        prompt: 'cineco-frontend-developer',
        agentType: 'claude'
      })
    )

    const markup = await renderAgents()
    const labels = Array.from(
      markup.matchAll(/data-resolved-label="([^"]*)"/g),
      (match) => match[1]
    )

    expect(labels).toEqual([
      'cineco-frontend-developer (1)',
      'cineco-frontend-developer (2)',
      'cineco-frontend-developer (3)'
    ])
    expect(new Set(labels).size).toBe(3)
  })

  it.each(['full', 'compact'] as const)(
    'keeps a named parent label with a synthetic child in %s mode',
    async (mode) => {
      displayMode = mode
      agents = [
        agent({
          paneKey: 'tab-1:1',
          conversationName: 'Named parent',
          prompt: 'Parent prompt',
          agentType: 'claude',
          lineage: { depth: 0, isFirstSibling: true, isLastSibling: true, childCount: 1 }
        }),
        agent({
          paneKey: 'synthetic:child',
          prompt: 'reviewer',
          agentType: 'reviewer',
          rowSource: 'subagent',
          parentPaneKey: 'tab-1:1',
          lineage: { depth: 1, isFirstSibling: true, isLastSibling: true, childCount: 0 }
        })
      ]

      const markup = await renderAgents()

      expect(markup).toContain(
        mode === 'full'
          ? 'data-pane-key="tab-1:1" data-resolved-label="Named parent"'
          : 'title="Named parent - Claude"'
      )
    }
  )
})
