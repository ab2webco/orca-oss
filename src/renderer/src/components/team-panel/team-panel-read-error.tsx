import { createContext, useContext } from 'react'
import { translate } from '@/i18n/i18n'
import { TeamPanelMessageState } from './team-panel-section-state'

/** Non-null while the panel shows the last team because the latest read failed. */
export const TeamReadRetryContext = createContext<(() => void) | null>(null)

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

/** The read error beside rows it makes stale. */
export function TeamReadNotice(): React.JSX.Element | null {
  const retry = useContext(TeamReadRetryContext)
  return retry ? (
    <div className="border-b border-border">
      <TeamReadError retry={retry} />
    </div>
  ) : null
}
