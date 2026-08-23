import { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentStateDot } from '@/components/AgentStateDot'
import { dashboardBucketLabel } from '../dashboard/dashboard-bucket-label'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { translate } from '@/i18n/i18n'
import type {
  DashboardBucket,
  DashboardCard,
  DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'
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
import { useAgentGridAvailableHeight, useAgentGridSize } from './use-agent-grid-width'
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
  const { width: measuredWidth } = useAgentGridSize(gridRef)
  const measuredHeight = useAgentGridAvailableHeight(gridRef)
  const gridWidth = measuredWidth || AGENT_GRID_FALLBACK_WIDTH
  const [pageSize, setPageSize] = useState(AGENT_GRID_DEFAULT_PAGE_SIZE)
  const [requestedPage, setRequestedPage] = useState(0)
  const [bucketFilter, setBucketFilter] = useState<DashboardBucket | null>(null)
  const allCells = useMemo(
    () => projects.flatMap((project) => project.cells.map((cell) => ({ project, cell }))),
    [projects]
  )
  const flatCells = useMemo(
    () =>
      bucketFilter ? allCells.filter((entry) => entry.cell.card.bucket === bucketFilter) : allCells,
    [allCells, bucketFilter]
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
    for (const entry of allCells) {
      totals[entry.cell.card.bucket] += 1
    }
    return totals
  }, [allCells])
  // Rows across every section on the page: one project fills the viewport, and
  // several fall back to the floor and let the page scroll (ORCA-234).
  const totalRows = visibleSections.reduce(
    (rows, section) =>
      rows +
      resolveAgentGridRows(
        section.cells.length,
        resolveAgentGridColumns(gridWidth, section.cells.length)
      ),
    0
  )
  const sectionChrome = 28 * visibleSections.length
  const rowHeight =
    measuredHeight > 0 && totalRows > 0
      ? Math.max(
          resolveAgentGridMinCellHeight(page.visible.length),
          (measuredHeight - sectionChrome) / totalRows
        )
      : 0
  // Height is shared by the sections, so the shortest cell decides the tail budget.
  const cellHeight = rowHeight
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
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {allCells.length > 1 ? (
            <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <span className="mr-3 flex items-center gap-2.5">
                {(
                  [
                    ['attention', 'waiting'],
                    ['working', 'working'],
                    ['done', 'done']
                  ] as const
                ).map(([bucket, dot]) => (
                  <button
                    key={bucket}
                    type="button"
                    aria-pressed={bucketFilter === bucket}
                    disabled={bucketTotals[bucket] === 0 && bucketFilter !== bucket}
                    onClick={() => {
                      setBucketFilter((current) => (current === bucket ? null : bucket))
                      setRequestedPage(0)
                    }}
                    className={cn(
                      'flex items-center gap-1 rounded px-1.5 py-0.5 disabled:opacity-40',
                      bucketFilter === bucket
                        ? 'bg-accent text-foreground'
                        : 'hover:bg-accent/60 hover:text-foreground'
                    )}
                  >
                    <AgentStateDot state={dot} size="sm" />
                    <span>{dashboardBucketLabel(bucket)}</span>
                    <span className="tabular-nums text-foreground">{bucketTotals[bucket]}</span>
                  </button>
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
              <section key={project.repoId} className="flex shrink-0 flex-col gap-2">
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
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridAutoRows: rowHeight > 0 ? `${Math.round(rowHeight)}px` : `${minCellHeight}px`,
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
