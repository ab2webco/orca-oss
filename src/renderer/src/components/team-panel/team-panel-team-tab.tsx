import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'
import { TeamTabContent } from './TeamTabContent'
import { useTeamArcadeActions } from './use-team-arcade-actions'
import { useTeamPanelLook } from './use-team-panel-look'

const AGE_TICK_MS = 30_000

export function TeamPanelTeamTab({
  value,
  selectTab
}: TeamPanelTabBodyProps<TeamPanelGameModel>): React.JSX.Element {
  const look = useTeamPanelLook()
  const openTaskPage = useAppStore((s) => s.openTaskPage)
  const arcadeActions = useTeamArcadeActions(value)
  // Why: ages are minute-grained; a 30 s tick keeps them current without per-frame renders.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <TeamTabContent
      model={value}
      look={look}
      selectTab={selectTab}
      now={now}
      arcadeActions={arcadeActions}
      onOpenTasks={() => openTaskPage()}
    />
  )
}
