import { useTranslation } from 'react-i18next'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { TeamHost } from '../../../../shared/team-panel-model-types'
import { useAppStore } from '@/store'
import { teamHostText } from './team-card-text'

/** A machine's name in the Team panel: the user's rename of this machine wins (ORCA-1149). */
export function TeamHostName({ host }: { host: TeamHost }): React.JSX.Element {
  // Why: the label is translated, and the cards it sits in are memoized.
  useTranslation()
  const renamed = useAppStore(
    (s) => s.settings?.hostSettingOverrides?.[LOCAL_EXECUTION_HOST_ID]?.displayLabel
  )
  return <>{teamHostText(host, renamed)}</>
}
