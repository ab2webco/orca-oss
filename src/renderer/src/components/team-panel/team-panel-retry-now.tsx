import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TeamSectionError } from '../../../../shared/team-panel-model-types'
import { refreshTeamPanelModelFresh } from './use-team-panel-model'

/** V30's error title names the provider, but only one the read named. */
export const teamSectionErrorTitle = (error: TeamSectionError, fallback: string): string =>
  error.provider
    ? translate('teamPanel.state.providerErrorTitle', '{{provider}} did not answer', {
        provider: error.provider
      })
    : fallback

/** Asks the host for a fresh read; hidden while the budget is spent, since it cannot succeed yet. */
export function TeamRetryNowButton({
  error
}: {
  error: TeamSectionError
}): React.JSX.Element | null {
  const [reading, setReading] = useState(false)
  if (error.limited) {
    return null
  }
  return (
    <Button
      variant="outline"
      size="xs"
      data-team-retry-now=""
      disabled={reading}
      onClick={() => {
        setReading(true)
        void refreshTeamPanelModelFresh().finally(() => setReading(false))
      }}
    >
      {translate('teamPanel.state.retryNow', 'Retry now')}
    </Button>
  )
}
