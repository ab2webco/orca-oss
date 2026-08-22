// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import type {
  AgentSessionLogPaneReading,
  AgentSessionLogReading
} from '../../../../shared/agent-session-log-state'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { TooltipProvider } from '@/components/ui/tooltip'
import { i18n } from '@/i18n/i18n'
import { AgentGridView } from './AgentGridView'

vi.mock('./AgentDashboardToolbar', () => ({
  AgentDashboardToolbar: () => <div data-testid="toolbar" />
}))

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab1:leaf1',
    ptyId: 'p1',
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    repoId: 'r1',
    worktreeId: 'w1',
    tabId: 'tab1',
    leafId: 'l1',
    repoName: 'Alpha',
    worktreeName: 'wt',
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false,
    ...overrides
  }
}

function working(text: string, tool: string | null): AgentSessionLogReading {
  return {
    read: true,
    state: 'working',
    lastTurnAtMs: 60_000,
    queuedInput: { supported: true, pending: 0 },
    unparsedRecords: 0,
    activity: {
      lastAssistantText: text,
      pendingToolName: tool,
      atMs: 60_000,
      textBeyondScan: false
    }
  }
}

function renderGrid(
  cards: DashboardCard[],
  readings: AgentSessionLogPaneReading[]
): { readPanes: ReturnType<typeof vi.fn> } {
  const snapshot: DashboardSnapshot = { generatedAt: 1, cards }
  const readPanes = vi.fn(async () => readings)
  // The pop-out wraps every view in one provider; the cell's truncation
  // tooltips need it here too.
  render(
    <TooltipProvider>
      <AgentGridView
      snapshot={snapshot}
      cards={cards}
      query=""
      onQueryChange={vi.fn()}
      filters={{}}
      onFiltersChange={vi.fn()}
      searchInputRef={createRef<HTMLInputElement>()}
      now={120_000}
      onRevealAgent={vi.fn()}
      readPanes={readPanes}
        pollIntervalMs={1_000_000}
      />
    </TooltipProvider>
  )
  return { readPanes }
}

describe('AgentGridView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // The whole point of the ticket: reading one agent must not require opening
  // anything, so every cell's content is on screen at the same time.
  it('shows what every agent is doing at once, with no dialog in the way', async () => {
    const cards = [
      card({ paneKey: 'p1', worktreeName: 'wt-one' }),
      card({ paneKey: 'p2', worktreeName: 'wt-two' }),
      card({ paneKey: 'p3', worktreeName: 'wt-three', repoId: 'r2', repoName: 'Beta' })
    ]
    renderGrid(cards, [
      { paneKey: 'p1', agent: 'claude', sessionId: 's1', session: working('rewriting the parser', 'Edit') },
      { paneKey: 'p2', agent: 'claude', sessionId: 's2', session: working('waiting on CI', null) },
      { paneKey: 'p3', agent: 'codex', sessionId: 's3', session: working('reading the config', 'Read') }
    ])

    await waitFor(() => expect(screen.getByText('rewriting the parser')).toBeInTheDocument())
    expect(screen.getByText('waiting on CI')).toBeInTheDocument()
    expect(screen.getByText('reading the config')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('groups the cells under their project', async () => {
    const cards = [
      card({ paneKey: 'p1', worktreeName: 'wt-one' }),
      card({ paneKey: 'p2', worktreeName: 'wt-two' }),
      card({ paneKey: 'p3', worktreeName: 'wt-three', repoId: 'r2', repoName: 'Beta' })
    ]
    renderGrid(cards, [])
    const alpha = (await screen.findByText('Alpha')).closest('section')
    const beta = screen.getByText('Beta').closest('section')
    expect(within(alpha as HTMLElement).getAllByRole('button')).toHaveLength(2)
    expect(within(beta as HTMLElement).getAllByRole('button')).toHaveLength(1)
    expect(within(alpha as HTMLElement).getByText('2 agents')).toBeInTheDocument()
  })

  it('names why a cell is blank instead of leaving it empty', async () => {
    renderGrid([card({ paneKey: 'p1' })], [
      {
        paneKey: 'p1',
        agent: null,
        sessionId: null,
        session: { read: false, reason: 'agent-session-unknown' }
      }
    ])
    await waitFor(() =>
      expect(screen.getAllByText('Session not identified yet').length).toBeGreaterThan(0)
    )
  })

  it('asks for every visible pane in one batch call', async () => {
    const cards = [card({ paneKey: 'p1' }), card({ paneKey: 'p2' })]
    const { readPanes } = renderGrid(cards, [])
    await waitFor(() => expect(readPanes).toHaveBeenCalledTimes(1))
    expect(readPanes).toHaveBeenCalledWith(['p1', 'p2'])
  })
})
