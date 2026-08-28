import { useCallback, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentStateDot } from '@/components/AgentStateDot'
import { dashboardBucketLabel } from '../dashboard/dashboard-bucket-label'
import { agentGridBucketForDotState } from './agent-grid-buckets'
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
  AGENT_GRID_PAGE_SIZE_OPTIONS
} from './agent-grid-visible-count'
import { AGENT_TERMINAL_TAIL_MAX_LINES } from '../../../../shared/agent-terminal-tail'
import { useAgentGridAvailableHeight, useAgentGridSize } from './use-agent-grid-width'
import type { DashboardFilters } from './agent-board-filtering'
import type { AgentRevealArgs } from './AgentTerminalDialog'
import {
  useAgentSessionLogReadings,
  type AgentSessionLogReadPanes
} from './use-agent-session-log-readings'
import { useAgentTerminalTails, type AgentTerminalTailReadPtys } from './use-agent-terminal-tails'

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
  const [bucketFilter, setBucketFilter] = useState<DashboardBucket | null>(null)
  const [collapsedRepoIds, setCollapsedRepoIds] = useState<readonly string[]>([])
  const toggleRepoCollapsed = useCallback((repoId: string) => {
    setCollapsedRepoIds((current) =>
      current.includes(repoId) ? current.filter((id) => id !== repoId) : [...current, repoId]
    )
  }, [])
  const allCells = useMemo(
    () => projects.flatMap((project) => project.cells.map((cell) => ({ project, cell }))),
    [projects]
  )
  const flatCells = useMemo(
    () =>
      bucketFilter
        ? allCells.filter(
            (entry) =>
              agentGridBucketForDotState(entry.cell.dotState, entry.cell.card.unseen) ===
              bucketFilter
          )
        : allCells,
    [allCells, bucketFilter]
  )

  // Sections keep the project grouping; everything renders and the page scrolls.
  const visibleSections = useMemo(() => {
    const byRepo = new Map<
      string,
      { repoId: string; repoName: string; cells: AgentGridCellModel[] }
    >()
    for (const entry of flatCells) {
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
  }, [flatCells])
  // Why quantized: AgentGridCell is memo'd but `now` ticks every second, so a
  // raw clock re-rendered every cell on every tick and the memo bought nothing.
  // The cells only print a coarse "N ago", which 15s cannot make wrong.
  const coarseNow = Math.floor(now / 15_000) * 15_000
  const bucketTotals = useMemo(() => {
    const totals = { attention: 0, working: 0, done: 0, idle: 0 }
    for (const entry of allCells) {
      totals[agentGridBucketForDotState(entry.cell.dotState, entry.cell.card.unseen)] += 1
    }
    return totals
  }, [allCells])
  // Rows across every section on the page: one project fills the viewport, and
  // several fall back to the floor and let the page scroll (ORCA-234).
  // The chosen count is how many fill the viewport at once; the rest scroll.
  const rowsOnScreen = Math.max(
    1,
    resolveAgentGridRows(pageSize, resolveAgentGridColumns(gridWidth, pageSize))
  )
  const rowHeight =
    measuredHeight > 0
      ? Math.max(
          resolveAgentGridMinCellHeight(pageSize),
          (measuredHeight - 28 * Math.max(1, visibleSections.length)) / rowsOnScreen
        )
      : 0
  // Height is shared by the sections, so the shortest cell decides the tail budget.
  const cellHeight = rowHeight
  const tailLines = resolveAgentGridTailLines(cellHeight, AGENT_TERMINAL_TAIL_MAX_LINES)
  // Only what this page renders: an off-page pane costs a terminal read per tick.
  const visiblePtyKey = flatCells.map((entry) => entry.cell.card.ptyId ?? '').join('\u0000')
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
      <div
        data-agent-grid-scroll-container
        className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {allCells.length > 1 ? (
          <div
            data-agent-grid-controls
            className="sticky top-0 z-10 flex shrink-0 items-center gap-1 bg-background text-[11px] text-muted-foreground"
          >
            <span className="mr-3 flex items-center gap-2.5">
              {(
                [
                  ['attention', 'waiting'],
                  ['working', 'working'],
                  ['done', 'done'],
                  ['idle', 'idle']
                ] as const
              ).map(([bucket, dot]) => (
                <button
                  key={bucket}
                  type="button"
                  aria-pressed={bucketFilter === bucket}
                  disabled={bucketTotals[bucket] === 0 && bucketFilter !== bucket}
                  onClick={() => {
                    setBucketFilter((current) => (current === bucket ? null : bucket))
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
          </div>
        ) : null}
        {/* Measured here, not on the scroll box: this is the element the tracks
            are laid out in, so its width is the one the column count answers.
            No max-width: a reading measure would centre the grid and leave the
            margins the owner reported; width is what makes a tail legible, and
            the column count already caps how wide a cell gets (ORCA-286). */}
        <div ref={gridRef} className="flex w-full flex-col gap-4">
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
              const collapsed = collapsedRepoIds.includes(project.repoId)
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
                    <button
                      type="button"
                      data-repo-collapse={project.repoId}
                      aria-pressed={collapsed}
                      aria-label={project.repoName}
                      onClick={() => toggleRepoCollapsed(project.repoId)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    >
                      {collapsed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </h2>
                  {collapsed ? null : (
                    <div
                      data-agent-grid-columns={columns}
                      data-agent-grid-rows={rows}
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        gridAutoRows:
                          rowHeight > 0 ? `${Math.round(rowHeight)}px` : `${minCellHeight}px`,
                        gap: `${AGENT_GRID_CELL_GAP}px`
                      }}
                    >
                      {project.cells.map((cell, index) => (
                        <div
                          key={cell.card.paneKey}
                          data-agent-grid-cell={cell.card.paneKey}
                          className="min-h-0 min-w-0"
                          style={{ gridColumn: `span ${spans[index] ?? 1}` }}
                        >
                          <AgentGridCell
                            cell={cell}
                            tail={cell.card.ptyId ? tails.get(cell.card.ptyId) : undefined}
                            now={coarseNow}
                            onReveal={handleReveal}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
