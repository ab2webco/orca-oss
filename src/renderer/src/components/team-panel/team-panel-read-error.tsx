import { createContext, useContext } from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { TeamPanelMessageState } from './team-panel-section-state'

/** How the last read went while the panel shows the last team; null while it reads fine. */
export type TeamReadStatus = { kind: 'failed'; retry: () => void } | { kind: 'updating' }

export const TeamReadStatusContext = createContext<TeamReadStatus | null>(null)

export const teamReadStatusOf = (source: {
  retry: (() => void) | null
  updating?: boolean
}): TeamReadStatus | null =>
  source.retry
    ? { kind: 'failed', retry: source.retry }
    : source.updating
      ? { kind: 'updating' }
      : null

export function TeamReadError({ retry }: { retry: (() => void) | null }): React.JSX.Element {
  return (
    <TeamPanelMessageState
      title={translate('teamPanel.state.modelErrorTitle', 'Could not read the team')}
      text={translate(
        'teamPanel.state.modelErrorText',
        'Orca is not responding in this project. Try again.'
      )}
      tone="error"
      action={
        retry ? { label: translate('teamPanel.state.retry', 'Try again'), onClick: retry } : null
      }
    />
  )
}

/** The read error beside rows it makes stale, or a quiet line while a brief miss lasts (ORCA-1199). */
export function TeamReadNotice(): React.JSX.Element | null {
  const status = useContext(TeamReadStatusContext)
  if (status?.kind === 'updating') {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
        {translate('teamPanel.state.updating', 'Updating the team…')}
      </p>
    )
  }
  return status?.kind === 'failed' ? (
    <div className="border-b border-border">
      <TeamReadError retry={status.retry} />
    </div>
  ) : null
}
