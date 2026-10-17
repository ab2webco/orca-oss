import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { useMountedRef } from '@/hooks/useMountedRef'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { useAppStore } from '../../store'
import { formatBytes } from '../status-bar/workspace-space-format'
import { navigateResourceSessionToTab } from '../status-bar/resource-session-navigation'
import { notifyDaemonSessionInventoryInvalidated } from '../status-bar/daemon-session-inventory-invalidation'
import { formatAgentTypeLabel } from '../../../../shared/agent-type-label'
import { resolveMemoryPressureWarningSettings } from '../../../../shared/memory-pressure-settings'
import type {
  MemoryPressureReading,
  MemoryPressureState,
  MemoryPressureWarning
} from '../../../../shared/memory-pressure-types'
import {
  buildMemoryPressureRows,
  countRemoteTerminals,
  type MemoryPressureRow
} from './memory-pressure-warning-rows'
import { MemoryPressureCloseDialog } from './MemoryPressureCloseDialog'

function untitledLabel(): string {
  return translate(
    'auto.components.memoryPressure.MemoryPressureWarningCard.untitled',
    'Background terminal'
  )
}

function readingSummary(reading: MemoryPressureReading): string {
  const free = translate(
    'auto.components.memoryPressure.MemoryPressureWarningCard.freeSummary',
    '{{value0}} of {{value1}} free.',
    { value0: formatBytes(reading.availableMemory), value1: formatBytes(reading.totalMemory) }
  )
  if (!reading.swapTotal || reading.swapUsed === null) {
    return free
  }
  const swap = translate(
    'auto.components.memoryPressure.MemoryPressureWarningCard.swapSummary',
    'Swap {{value0}} of {{value1}}.',
    { value0: formatBytes(reading.swapUsed), value1: formatBytes(reading.swapTotal) }
  )
  return `${free} ${swap}`
}

function rowMeta(row: MemoryPressureRow): string {
  const idle =
    row.idleMs === null
      ? translate(
          'auto.components.memoryPressure.MemoryPressureWarningCard.idleUnknown',
          'idle time unknown'
        )
      : translate(
          'auto.components.memoryPressure.MemoryPressureWarningCard.lastOutput',
          'last output {{value0}}',
          { value0: formatUiRelativeTime(-row.idleMs) }
        )
  return [row.agentType ? formatAgentTypeLabel(row.agentType) : null, row.project, idle]
    .filter(Boolean)
    .join(' · ')
}

/** Non-modal low-memory card: names the heaviest terminals and offers Open and Close. Never closes anything itself. */
export function MemoryPressureWarningCard(): React.JSX.Element | null {
  const [warning, setWarning] = useState<MemoryPressureWarning | null>(null)
  const [closeTarget, setCloseTarget] = useState<MemoryPressureRow | null>(null)
  const [closing, setClosing] = useState(false)
  const mountedRef = useMountedRef()
  const enabled = useAppStore((s) => resolveMemoryPressureWarningSettings(s.settings ?? {}).enabled)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const repos = useAppStore((s) => s.repos)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateCardVisible = updateStatus.state !== 'idle' && updateStatus.state !== 'not-available'

  useEffect(() => {
    const apply = (state: MemoryPressureState): void => setWarning(state.warning)
    const unsubscribe = window.api.memory.onPressureWarning(apply)
    void window.api.memory.getPressureWarning().then(
      (state) => mountedRef.current && apply(state),
      () => {}
    )
    return unsubscribe
  }, [mountedRef])

  const ctx = useMemo(
    () => ({
      tabsByWorktree,
      ptyIdsByTabId,
      agentStatusByPaneKey,
      repoConnectionIdById: new Map(repos.map((repo) => [repo.id, repo.connectionId ?? null]))
    }),
    [tabsByWorktree, ptyIdsByTabId, agentStatusByPaneKey, repos]
  )
  const rows = useMemo(
    () => (warning ? buildMemoryPressureRows(warning.panes, ctx, Date.now()) : []),
    [warning, ctx]
  )
  const remoteCount = useMemo(() => countRemoteTerminals(ctx), [ctx])

  const dismiss = useCallback((): void => {
    if (!warning) {
      return
    }
    setWarning(null)
    void window.api.memory.dismissPressureWarning(warning.episodeId)
  }, [warning])

  const openRow = (row: MemoryPressureRow): void => {
    if (!row.tabId) {
      return
    }
    navigateResourceSessionToTab(row.tabId, row.paneKey, {
      tabsByWorktree,
      setOpen: () => {},
      setActiveView,
      activateAndRevealWorktree,
      activateTabAndFocusPane
    })
  }

  const confirmClose = async (): Promise<void> => {
    if (!closeTarget) {
      return
    }
    setClosing(true)
    try {
      await window.api.pty.kill(closeTarget.sessionId)
      notifyDaemonSessionInventoryInvalidated()
      const next = await window.api.memory.refreshPressureWarning()
      if (mountedRef.current) {
        setWarning(next.warning)
      }
    } catch {
      // The row stays listed so the user can retry; the next sweep drops it if it did exit.
    } finally {
      if (mountedRef.current) {
        setClosing(false)
        setCloseTarget(null)
      }
    }
  }

  if (!enabled || !warning) {
    return null
  }

  return (
    <div
      // Why: UpdateCard owns bottom-10 when it shows; sit above it rather than cover an update prompt.
      className={`fixed right-4 z-40 w-[380px] max-w-[calc(100vw-32px)] max-[480px]:left-4 max-[480px]:right-4 max-[480px]:w-auto ${
        updateCardVisible ? 'bottom-[220px]' : 'bottom-10'
      }`}
      data-testid="memory-pressure-warning"
    >
      <Card className="gap-0 py-0" role="complementary" aria-labelledby="memory-pressure-heading">
        <div className="flex flex-col gap-2.5 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <h3 id="memory-pressure-heading" className="text-sm font-semibold">
                  {translate(
                    'auto.components.memoryPressure.MemoryPressureWarningCard.title',
                    'Memory is running low'
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">{readingSummary(warning.reading)}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={dismiss}
              aria-label={translate(
                'auto.components.memoryPressure.MemoryPressureWarningCard.dismiss',
                'Dismiss'
              )}
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.memoryPressure.MemoryPressureWarningCard.lead',
              'These terminals use the most memory. Close the ones you no longer need before the system runs out.'
            )}
          </p>

          {warning.sweeping ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {translate(
                'auto.components.memoryPressure.MemoryPressureWarningCard.measuring',
                'Measuring terminals…'
              )}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.memoryPressure.MemoryPressureWarningCard.empty',
                'No local terminal is holding much memory. Other apps may be the cause.'
              )}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60 rounded-md border border-border/60">
              {rows.map((row) => (
                <li key={row.sessionId} className="flex flex-col gap-1 px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {row.title ?? untitledLabel()}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-foreground">
                      {formatBytes(row.memory)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {rowMeta(row)}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={!row.tabId}
                        onClick={() => openRow(row)}
                      >
                        {translate(
                          'auto.components.memoryPressure.MemoryPressureWarningCard.open',
                          'Open'
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setCloseTarget(row)}
                      >
                        {translate(
                          'auto.components.memoryPressure.MemoryPressureWarningCard.close',
                          'Close'
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {remoteCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.memoryPressure.MemoryPressureWarningCard.remote',
                'SSH terminals run on their remote hosts and are not counted here ({{value0}} open).',
                { value0: String(remoteCount) }
              )}
            </p>
          ) : null}
        </div>
      </Card>
      <MemoryPressureCloseDialog
        targetTitle={closeTarget ? (closeTarget.title ?? untitledLabel()) : null}
        closing={closing}
        onCancel={() => setCloseTarget(null)}
        onConfirm={() => void confirmClose()}
      />
    </div>
  )
}
