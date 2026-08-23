import { useCallback, useMemo, useRef } from 'react'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { translate } from '@/i18n/i18n'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { AgentDashboardToolbar } from './AgentDashboardToolbar'
import { AgentGridCell } from './AgentGridCell'
import { buildAgentGrid, type AgentGridCellModel } from './agent-grid-model'
import {
  AGENT_GRID_CELL_GAP,
  AGENT_GRID_CELL_HEIGHT,
  AGENT_GRID_FALLBACK_WIDTH,
  AGENT_GRID_TAIL_LINES,
  resolveAgentGridColumns
} from './agent-grid-columns'
import { useAgentGridWidth } from './use-agent-grid-width'
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
  pollIntervalMs
}: AgentGridViewProps): React.JSX.Element {
  const paneKeys = useMemo(() => cards.map((card) => card.paneKey), [cards])
  const ptyIds = useMemo(
    () => cards.flatMap((card) => (card.ptyId ? [card.ptyId] : [])),
    [cards]
  )
  const readings = useAgentSessionLogReadings(paneKeys, { readPanes, intervalMs: pollIntervalMs })
  const tails = useAgentTerminalTails(ptyIds, {
    readPtys,
    intervalMs: pollIntervalMs,
    lines: AGENT_GRID_TAIL_LINES
  })
  const projects = useMemo(() => buildAgentGrid(cards, readings), [cards, readings])
  const gridRef = useRef<HTMLDivElement>(null)
  const measuredWidth = useAgentGridWidth(gridRef)
  const columns = resolveAgentGridColumns(measuredWidth || AGENT_GRID_FALLBACK_WIDTH)
  const handleReveal = useCallback(
    (cell: AgentGridCellModel) => {
      const { card } = cell
      onRevealAgent({
        repoId: card.repoId,
        worktreeId: card.worktreeId,
        executionHostId: card.executionHostId,
        tabId: card.tabId,
        leafId: card.leafId
      })
    },
    [onRevealAgent]
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
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-3">
        {/* Measured here, not on the scroll box: this is the element the tracks
            are laid out in, so its width is the one the column count answers. */}
        <div ref={gridRef} className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
          {projects.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted-foreground">
              {translate('dashboardPopout.grid.empty', 'No agents to show')}
            </p>
          ) : (
            projects.map((project) => (
              <section key={project.repoId} className="flex flex-col gap-2">
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
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridAutoRows: `${AGENT_GRID_CELL_HEIGHT}px`,
                    gap: `${AGENT_GRID_CELL_GAP}px`
                  }}
                >
                  {project.cells.map((cell) => (
                    <AgentGridCell
                      key={cell.card.paneKey}
                      cell={cell}
                      tail={cell.card.ptyId ? tails.get(cell.card.ptyId) : undefined}
                      now={now}
                      onReveal={handleReveal}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  )
}
