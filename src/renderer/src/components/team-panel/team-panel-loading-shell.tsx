import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamPanelLook } from './use-team-panel-look'

const BONE = 'animate-pulse rounded bg-sidebar-accent motion-reduce:animate-none'

/**
 * The first read's skeleton: the header, then rows (P4).
 * Why no scene, tabs or lead card: a scope is loading only before any read, so it may hold no team (review M3).
 */
export function TeamPanelLoadingShell({
  look,
  children
}: {
  look: TeamPanelLook
  /** The panel header; outside the busy region, so the gear stays usable. */
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col" data-team-loading-shell={look}>
      {children}
      <div
        aria-busy="true"
        aria-label={translate('teamPanel.state.loading', 'Loading')}
        className="flex flex-col gap-1.5 px-3 py-2"
      >
        {[0, 1, 2].map((index) => (
          <div key={index} className={cn(BONE, 'h-9 rounded-md')} />
        ))}
      </div>
    </div>
  )
}
