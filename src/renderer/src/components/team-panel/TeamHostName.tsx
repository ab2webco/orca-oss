import type { TeamHost } from '../../../../shared/team-panel-model-types'
import { useLocalHostName } from '@/lib/use-local-host-name'
import { teamHostText } from './team-card-text'

/** A machine's name in the Team panel: the user's rename of this machine wins (ORCA-1149). */
export function TeamHostName({ host }: { host: TeamHost }): React.JSX.Element {
  return <>{teamHostText(host, useLocalHostName())}</>
}
