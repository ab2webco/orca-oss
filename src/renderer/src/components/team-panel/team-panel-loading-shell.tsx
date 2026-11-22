import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { TEAM_SCENE_ART_HEIGHT } from '../team-scene/team-scene-image-painter'
import type { TeamPanelLook } from './use-team-panel-look'

const BONE = 'animate-pulse rounded bg-sidebar-accent motion-reduce:animate-none'

/** The first read's skeleton in V30's layout: scene, header, tabs, the lead's card, then rows (P4). */
export function TeamPanelLoadingShell({
  look,
  children
}: {
  look: TeamPanelLook
  /** The panel header, which V30 draws under the scene; outside the busy region, so the gear stays usable. */
  children: React.ReactNode
}): React.JSX.Element {
  const game = look === 'game'
  return (
    <div className="flex min-h-0 flex-col" data-team-loading-shell={look}>
      {look === 'plain' ? null : (
        <div aria-hidden="true" className="shrink-0 border-b border-border p-2">
          <div
            data-team-loading-scene=""
            className={cn(BONE, 'rounded-md')}
            style={{ height: game ? TEAM_SCENE_ART_HEIGHT - 16 : 106 }}
          />
        </div>
      )}
      {children}
      <div aria-busy="true" aria-label={translate('teamPanel.state.loading', 'Loading')}>
        <div
          data-team-loading-tabs=""
          className="flex h-[35px] items-center gap-4 border-b border-border px-3"
        >
          {[44, 52, 30].map((width) => (
            <div key={width} className={cn(BONE, 'h-3')} style={{ width }} />
          ))}
        </div>
        <div
          data-team-loading-lead=""
          className="flex items-start gap-2.5 border-b border-border py-2 pl-3 pr-9"
        >
          {game ? <div className={cn(BONE, 'size-[38px] shrink-0 rounded-[9px]')} /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <div className={cn(BONE, 'h-3 w-2/5')} />
            <div className={cn(BONE, 'h-3 w-4/5')} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 px-3 py-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className={cn(BONE, 'h-9 rounded-md')} />
          ))}
        </div>
      </div>
    </div>
  )
}
