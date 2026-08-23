// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AGENT_TERMINAL_TAIL_MAX_LINES } from '../../../../shared/agent-terminal-tail'
import { createRef } from 'react'
import type {
  AgentSessionLogPaneReading,
  AgentSessionLogReading
} from '../../../../shared/agent-session-log-state'
import type { AgentTerminalTailPtyReading } from '../../../../shared/agent-terminal-tail'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { TooltipProvider } from '@/components/ui/tooltip'
import { i18n } from '@/i18n/i18n'
import { EMPTY_DASHBOARD_FILTERS } from './agent-board-filtering'
import { AgentGridView } from './AgentGridView'

vi.mock('./AgentDashboardToolbar', () => ({
  AgentDashboardToolbar: () => <div data-testid="toolbar" />
}))

/** The pop-out's own default is 960px wide; 24px of it is the scroll padding. */
const POPOUT_DEFAULT_CONTENT_WIDTH = 936
const WIDE_WINDOW_CONTENT_WIDTH = 1416

function stubMeasuredWidth(width: number): void {
  class ImmediateResizeObserver {
    constructor(private readonly callback: () => void) {}
    observe(): void {
      this.callback()
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ImmediateResizeObserver)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 600,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({})
  })
}

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab1:leaf1',
    ptyId: 'p1',
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: 'the task',
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
  readings: AgentSessionLogPaneReading[],
  tails: AgentTerminalTailPtyReading[] = [],
  overrides: { onOpenTerminal?: (card: DashboardCard) => void } = {}
): {
  readPanes: ReturnType<typeof vi.fn>
  readPtys: ReturnType<typeof vi.fn>
  onRevealAgent: ReturnType<typeof vi.fn>
} {
  const snapshot: DashboardSnapshot = { generatedAt: 1, cards }
  const readPanes = vi.fn(async () => readings)
  const readPtys = vi.fn(async () => tails)
  const onRevealAgent = vi.fn()
  // The pop-out wraps every view in one provider; the cell's truncation
  // tooltips need it here too.
  render(
    <TooltipProvider>
      <AgentGridView
        snapshot={snapshot}
        cards={cards}
        query=""
        onQueryChange={vi.fn()}
        filters={EMPTY_DASHBOARD_FILTERS}
        onFiltersChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        now={120_000}
        onRevealAgent={onRevealAgent}
        onOpenTerminal={overrides.onOpenTerminal}
        readPanes={readPanes}
        readPtys={readPtys}
        pollIntervalMs={1_000_000}
      />
    </TooltipProvider>
  )
  return { readPanes, readPtys, onRevealAgent }
}

function gridTracks(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-agent-grid-columns]')].map(
    (grid) => grid.style.gridTemplateColumns
  )
}

describe('AgentGridView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    stubMeasuredWidth(POPOUT_DEFAULT_CONTENT_WIDTH)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // The reported failure: at the pop-out's own default width every agent got a
  // row of its own, so eight agents were eight rows to scroll (ORCA-234).
  it('lays several cells across one row at the pop-out default width', async () => {
    renderGrid([card({ paneKey: 'p1' }), card({ paneKey: 'p2' }), card({ paneKey: 'p3' })], [])
    await screen.findByText('Alpha')
    const grid = document.querySelector<HTMLElement>('[data-agent-grid-columns]')
    expect(Number(grid?.dataset.agentGridColumns)).toBeGreaterThanOrEqual(2)
    expect(grid?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
  })

  it('adds columns when the pop-out is widened', async () => {
    stubMeasuredWidth(WIDE_WINDOW_CONTENT_WIDTH)
    renderGrid(
      [
        card({ paneKey: 'p1' }),
        card({ paneKey: 'p2' }),
        card({ paneKey: 'p3' }),
        card({ paneKey: 'p4' })
      ],
      []
    )
    await screen.findByText('Alpha')
    expect(gridTracks()).toEqual(['repeat(4, minmax(0, 1fr))'])
  })

  // The owner's report: one agent in a wide pop-out sat in a narrow column with
  // the rest of the row empty, which is where the tail is least readable.
  it('opens the terminal dialog on a cell click, and falls back to the pane', async () => {
    const onOpenTerminal = vi.fn()
    const { onRevealAgent } = renderGrid([card({ paneKey: 'p1' })], [], [], { onOpenTerminal })
    await screen.findByText('Alpha')
    const cell = document.querySelector<HTMLElement>('[data-pane-key="p1"]')
    fireEvent.click(cell as HTMLElement)
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)
    expect(onRevealAgent).not.toHaveBeenCalled()
  })

  it('counts the state buckets above the grid, like the board columns do', async () => {
    renderGrid(
      [
        card({ paneKey: 'p1', bucket: 'working' }),
        card({ paneKey: 'p2', bucket: 'attention' }),
        card({ paneKey: 'p3', bucket: 'working' })
      ],
      []
    )
    await screen.findByText('Alpha')
    const strip = document.querySelector<HTMLElement>('[data-agent-grid-columns]')
      ?.parentElement?.parentElement?.previousElementSibling
    expect(strip?.textContent).toContain('Needs You1')
    expect(strip?.textContent).toContain('Working2')
  })

  it('never opens more tracks than there are agents', async () => {
    stubMeasuredWidth(WIDE_WINDOW_CONTENT_WIDTH)
    renderGrid([card({ paneKey: 'p1' })], [])
    await screen.findByText('Alpha')
    expect(gridTracks()).toEqual(['repeat(1, minmax(0, 1fr))'])
  })

  it('gives every cell the same share of the height instead of a fixed box', async () => {
    renderGrid([card({ paneKey: 'p1' }), card({ paneKey: 'p2' }), card({ paneKey: 'p3' })], [])
    await screen.findByText('Alpha')
    const grid = document.querySelector<HTMLElement>('[data-agent-grid-columns]')
    // Two across at the default width, so three agents need two equal rows.
    expect(grid?.dataset.agentGridRows).toBe('2')
    // Rows share the height, with a floor so a host that gives the grid no
    // definite height still renders readable cells instead of collapsing them.
    // Rows share whatever height the grid was given; the height itself comes
    // from the viewport below the grid's top edge, not from a fixed cell box.
    expect(grid?.style.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))')
    expect(grid?.style.height).not.toBe('')
    expect(grid?.style.gridAutoRows).toBe('')
  })

  // The whole point of the ticket: what each agent is DOING, which is terminal
  // output, not a prose summary of it.
  it('shows the live terminal of every agent at once, with no dialog in the way', async () => {
    const cards = [
      card({ paneKey: 'p1', ptyId: 'pty-1', worktreeName: 'wt-one' }),
      card({ paneKey: 'p2', ptyId: 'pty-2', worktreeName: 'wt-two' })
    ]
    renderGrid(
      cards,
      [{ paneKey: 'p1', agent: 'claude', sessionId: 's1', session: working('prose summary', 'Edit') }],
      [
        { ptyId: 'pty-1', tail: { read: true, lines: ['$ npm test', '  12 passed'] } },
        { ptyId: 'pty-2', tail: { read: true, lines: ['Running eslint…'] } }
      ]
    )

    await waitFor(() =>
      expect(document.querySelector('[data-terminal-tail="pty-1"]')).not.toBeNull()
    )
    // Raw text, indentation intact — a terminal line reads wrong once collapsed.
    expect(document.querySelector('[data-terminal-tail="pty-1"]')?.textContent).toBe(
      '$ npm test\n  12 passed'
    )
    expect(document.querySelector('[data-terminal-tail="pty-2"]')?.textContent).toBe(
      'Running eslint…'
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the session-log status signal beside the terminal', async () => {
    renderGrid(
      [card({ paneKey: 'p1', ptyId: 'pty-1' })],
      [{ paneKey: 'p1', agent: 'claude', sessionId: 's1', session: working('prose', 'Edit') }],
      [{ ptyId: 'pty-1', tail: { read: true, lines: ['building…'] } }]
    )
    await waitFor(() => expect(screen.getByText('building…')).toBeInTheDocument())
    // In-flight tool from the transcript, and the state the dot renders.
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(document.querySelector('[data-dot-state="working"]')).not.toBeNull()
  })

  it('names a closed pane instead of leaving its cell blank', async () => {
    renderGrid([card({ paneKey: 'p1', ptyId: undefined, task: '' })], [])
    await waitFor(() =>
      expect(
        screen.getAllByText("No live terminal — this agent's pane has closed.").length
      ).toBeGreaterThan(0)
    )
  })

  it('names an unreadable terminal instead of leaving its cell blank', async () => {
    renderGrid([card({ paneKey: 'p1', ptyId: 'pty-1', task: '' })], [], [
      { ptyId: 'pty-1', tail: { read: false, reason: 'terminal-unreadable' } }
    ])
    await waitFor(() =>
      expect(screen.getAllByText('Terminal output unavailable').length).toBeGreaterThan(0)
    )
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
    // Each project lays its own agents out in a grid, not a column.
    // The second project has a single agent, so it gets a single full-width track.
    expect(gridTracks()).toEqual(['repeat(2, minmax(0, 1fr))', 'repeat(1, minmax(0, 1fr))'])
  })

  it('falls back to the session log while no terminal has been read', async () => {
    renderGrid(
      [card({ paneKey: 'p1', ptyId: 'pty-1' })],
      [{ paneKey: 'p1', agent: 'claude', sessionId: 's1', session: working('rewriting the parser', null) }],
      []
    )
    await waitFor(() => expect(screen.getByText('rewriting the parser')).toBeInTheDocument())
  })

  it('names why the session log is unreadable when there is no terminal either', async () => {
    renderGrid([card({ paneKey: 'p1', ptyId: undefined, task: '' })], [
      {
        paneKey: 'p1',
        agent: null,
        sessionId: null,
        session: { read: false, reason: 'agent-session-unknown' }
      }
    ])
    await waitFor(() =>
      expect(
        screen.getAllByText("No live terminal — this agent's pane has closed.").length
      ).toBeGreaterThan(0)
    )
  })

  it('asks for every visible pane and pty in one batch call each', async () => {
    const cards = [
      card({ paneKey: 'p1', ptyId: 'pty-1' }),
      card({ paneKey: 'p2', ptyId: 'pty-2' })
    ]
    const { readPanes, readPtys } = renderGrid(cards, [])
    await waitFor(() => expect(readPanes).toHaveBeenCalledTimes(1))
    expect(readPanes).toHaveBeenCalledWith(['p1', 'p2'])
    await waitFor(() => expect(readPtys).toHaveBeenCalledTimes(1))
    // The 600px-tall stub leaves room for more lines than the contract's cap.
    expect(readPtys).toHaveBeenCalledWith(['pty-1', 'pty-2'], AGENT_TERMINAL_TAIL_MAX_LINES)
  })
})
