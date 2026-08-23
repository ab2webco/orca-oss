import { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentStateDot } from '@/components/AgentStateDot'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { translate } from '@/i18n/i18n'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { AgentDashboardToolbar } from './AgentDashboardToolbar'
import { AgentGridCell } from './AgentGridCell'
import { buildAgentGrid, type AgentGridCellModel } from './agent-grid-model'
import {
  AGENT_GRID_CELL_GAP,
  AGENT_GRID_FALLBACK_WIDTH,
  resolveAgentGridCellSpans,
  resolveAgentGridColumns,
  resolveAgentGridMinCellHeight,
  resolveAgentGridRows,
  resolveAgentGridTailLines
} from './agent-grid-columns'
import {
  AGENT_GRID_DEFAULT_PAGE_SIZE,
  AGENT_GRID_PAGE_SIZE_OPTIONS,
  resolveAgentGridPage
} from './agent-grid-paging'
import { AGENT_TERMINAL_TAIL_MAX_LINES } from '../../../../shared/agent-terminal-tail'
import { useAgentGridSize } from './use-agent-grid-width'
import type { DashboardFilters } from './agent-board-filtering'
import type { AgentRevealArgs } from './AgentTerminalDialog'
import {
  useAgentSessionLogReadings,
  type AgentSessionLogReadPanes
} from './use-agent-session-log-readings'
import {
  useAgentTerminalTails,
  type AgentTerminalTailReadPtys
} from './use-agent-terminal-tails'

export type AgentGridViewProps = {
  snapshot: DashboardSnapshot
  /** Cards after search + filters. */
  cards: DashboardCard[]
  query: string
  onQueryChange: (query: string) => void
  filters: DashboardFilters
  onFiltersChange: (filters: DashboardFilters) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  now: number
  onRevealAgent: (args: AgentRevealArgs) => void
  /** Opens the board's live-terminal dialog for a cell. Without it a click
   *  falls back to focusing the pane, which is what the grid did before. */
  onOpenTerminal?: (card: DashboardCard) => void
  /** Test seam: the batch session-log reader and its cadence. */
  readPanes?: AgentSessionLogReadPanes
  /** Test seam: the batch terminal-tail reader. */
  readPtys?: AgentTerminalTailReadPtys
  pollIntervalMs?: number
}

export function AgentGridView({
  snapshot,
  cards,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  searchInputRef,
  now,
  onRevealAgent,
  readPanes,
  readPtys,
  pollIntervalMs,
  onOpenTerminal
}: AgentGridViewProps): React.JSX.Element {
  const paneKeys = useMemo(() => cards.map((card) => card.paneKey), [cards])
  const readings = useAgentSessionLogReadings(paneKeys, { readPanes, intervalMs: pollIntervalMs })
  const projects = useMemo(() => buildAgentGrid(cards, readings), [cards, readings])
  const gridRef = useRef<HTMLDivElement>(null)
  const { width: measuredWidth, height: measuredHeight } = useAgentGridSize(gridRef)
  const gridWidth = measuredWidth || AGENT_GRID_FALLBACK_WIDTH
  const [pageSize, setPageSize] = useState(AGENT_GRID_DEFAULT_PAGE_SIZE)
  const [requestedPage, setRequestedPage] = useState(0)
  const flatCells = useMemo(
    () => projects.flatMap((project) => project.cells.map((cell) => ({ project, cell }))),
    [projects]
  )
  const page = useMemo(
    () => resolveAgentGridPage(flatCells, pageSize, requestedPage),
    [flatCells, pageSize, requestedPage]
  )
  // Sections keep the project grouping, but only for what this page shows.
  const visibleSections = useMemo(() => {
    const byRepo = new Map<string, { repoId: string; repoName: string; cells: AgentGridCellModel[] }>()
    for (const entry of page.visible) {
      const existing = byRepo.get(entry.project.repoId)
      if (existing) {
        existing.cells.push(entry.cell)
        continue
      }
      byRepo.set(entry.project.repoId, {
        repoId: entry.project.repoId,
        repoName: entry.project.repoName,
        cells: [entry.cell]
      })
    }
    return [...byRepo.values()]
  }, [page.visible])
  const bucketTotals = useMemo(() => {
    const totals = { attention: 0, working: 0, done: 0, idle: 0 }
    for (const entry of flatCells) {
      totals[entry.cell.card.bucket] += 1
    }
    return totals
  }, [flatCells])
  const tallestRows = visibleSections.reduce(
    (rows, section) =>
      Math.max(rows, resolveAgentGridRows(section.cells.length, resolveAgentGridColumns(gridWidth, section.cells.length))),
    1
  )
  // Height is shared by the sections, so the shortest cell decides the tail budget.
  const cellHeight = measuredHeight
    ? (measuredHeight - (visibleSections.length - 1) * 24) / Math.max(1, tallestRows) -
      (tallestRows - 1) * AGENT_GRID_CELL_GAP
    : 0
  const tailLines = resolveAgentGridTailLines(cellHeight, AGENT_TERMINAL_TAIL_MAX_LINES)
  // Only what this page renders: an off-page pane costs a terminal read per tick.
  const visiblePtyKey = page.visible
    .map((entry) => entry.cell.card.ptyId ?? '')
    .join('\u0000')
  // Keyed by the joined ids: a fresh array each render would resubscribe the
  // batch reader and double its IPC per tick.
  const visiblePtyIds = useMemo(
    () => visiblePtyKey.split('\u0000').filter((id) => id.length > 0),
    [visiblePtyKey]
  )
  // Why wait for the measure: reading before it costs one batch at the wrong
  // line budget, then a second at the right one.
  const tails = useAgentTerminalTails(measuredHeight > 0 ? visiblePtyIds : [], {
    readPtys,
    intervalMs: pollIntervalMs,
    lines: tailLines
  })
  const handleReveal = useCallback(
    (cell: AgentGridCellModel) => {
      const { card } = cell
      if (onOpenTerminal) {
        onOpenTerminal(card)
        return
      }
      onRevealAgent({
        repoId: card.repoId,
        worktreeId: card.worktreeId,
        executionHostId: card.executionHostId,
        tabId: card.tabId,
        leafId: card.leafId
      })
    },
    [onOpenTerminal, onRevealAgent]
  )

  return (
    <>
      <AgentDashboardToolbar
        cards={snapshot.cards}
        filterOptions={snapshot.filterOptions}
        filteredCount={cards.length}
        query={query}
        onQueryChange={onQueryChange}
        filters={filters}
        onFiltersChange={onFiltersChange}
        searchInputRef={searchInputRef}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {flatCells.length > 1 ? (
            <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <span className="mr-3 flex items-center gap-2.5">
                {(
                  [
                    ['attention', 'waiting', 'dashboardPopout.bucket.attention', 'Needs You'],
                    ['working', 'working', 'dashboardPopout.bucket.working', 'Working'],
                    ['done', 'done', 'dashboardPopout.bucket.done', 'Done']
                  ] as const
                ).map(([bucket, dot, key, fallback]) => (
                  <span key={bucket} className="flex items-center gap-1">
                    <AgentStateDot state={dot} size="sm" />
                    <span>{translate(key, fallback)}</span>
                    <span className="tabular-nums text-foreground">{bucketTotals[bucket]}</span>
                  </span>
                ))}
              </span>
              {AGENT_GRID_PAGE_SIZE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`${option}`}
                  aria-pressed={option === pageSize}
                  onClick={() => {
                    setPageSize(option)
                    setRequestedPage(0)
                  }}
                  className={cn(
                    'rounded px-1.5 py-0.5 tabular-nums',
                    option === pageSize
                      ? 'bg-accent text-foreground'
                      : 'hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  {option}
                </button>
              ))}
              {page.pageCount > 1 ? (
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`${page.pageIndex}`}
                    disabled={page.pageIndex === 0}
                    onClick={() => setRequestedPage(page.pageIndex - 1)}
                    className="rounded p-0.5 disabled:opacity-40 hover:bg-accent/60"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <span className="tabular-nums">
                    {page.pageIndex + 1}/{page.pageCount}
                  </span>
                  <button
                    type="button"
                    aria-label={`${page.pageIndex + 2}`}
                    disabled={page.pageIndex >= page.pageCount - 1}
                    onClick={() => setRequestedPage(page.pageIndex + 1)}
                    className="rounded p-0.5 disabled:opacity-40 hover:bg-accent/60"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
        {/* Measured here, not on the scroll box: this is the element the tracks
            are laid out in, so its width is the one the column count answers. */}
        <div ref={gridRef} className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
          {projects.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted-foreground">
              {translate('dashboardPopout.grid.empty', 'No agents to show')}
            </p>
          ) : (
            visibleSections.map((project) => {
              const columns = resolveAgentGridColumns(gridWidth, project.cells.length)
              const rows = resolveAgentGridRows(project.cells.length, columns)
              const minCellHeight = resolveAgentGridMinCellHeight(project.cells.length)
              const spans = resolveAgentGridCellSpans(project.cells.length, columns)
              return (
              <section key={project.repoId} className="flex min-h-0 flex-1 flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                  <RepoIconGlyph
                    repoIcon={snapshot.repoIconsByRepoId?.[project.repoId] ?? null}
                    iconClassName="size-3.5"
                  />
                  <span className="truncate">{project.repoName}</span>
                  <span className="font-normal tracking-normal normal-case">
                    {translate('dashboardPopout.grid.agentCount', '{{count}} agents', {
                      count: project.cells.length
                    })}
                  </span>
                </h2>
                <div
                  data-agent-grid-columns={columns}
                  data-agent-grid-rows={rows}
                  className="grid min-h-0 flex-1"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rows}, minmax(${minCellHeight}px, 1fr))`,
                    gap: `${AGENT_GRID_CELL_GAP}px`
                  }}
                >
                  {project.cells.map((cell, index) => (
                    <div
                      key={cell.card.paneKey}
                      className="min-h-0 min-w-0"
                      style={{ gridColumn: `span ${spans[index] ?? 1}` }}
                    >
                    <AgentGridCell
                      cell={cell}
                      tail={cell.card.ptyId ? tails.get(cell.card.ptyId) : undefined}
                      now={now}
                      onReveal={handleReveal}
                    />
                    </div>
                  ))}
                </div>
              </section>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
