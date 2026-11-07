import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { requestNewGameAction } from '@/components/settings/game-actions-settings-intent'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { TeamActionDock } from './TeamActionDock'
import { teamLeadTurnOf } from './team-lead-turn'
import { teamActionLabel } from './team-action-words'
import { openTeamSession } from './team-session-open'
import { useTeamLeadPrompt } from './use-team-lead-prompt'

/** The dock fed by the lead's pane: its hook status ends a run and carries the reply. */
export function TeamActionDockConnected({
  model,
  onOpenActions
}: {
  model: TeamPanelGameModel
  onOpenActions: (repoId: string) => void
}): React.JSX.Element | null {
  const send = useTeamLeadPrompt()
  const { lead } = model
  const entry = useAppStore((s) => s.agentStatusByPaneKey[lead.paneKey])
  const turn = useMemo(() => teamLeadTurnOf(entry), [entry])
  // Why hidden: with no lead pane to write to, nothing in the dock could run.
  if (!send) {
    return null
  }
  return (
    <TeamActionDock
      actions={model.actions}
      memberCount={model.members.length}
      lead={turn}
      onRun={async (action) =>
        action.send
          ? send(action.id, action.send, teamActionLabel(action), { quiet: turn !== null })
          : false
      }
      onOpenLead={() => void openTeamSession(lead, lead.name)}
      onNewAction={() => {
        requestNewGameAction(model.repoId)
        onOpenActions(model.repoId)
      }}
      onEditActions={() => onOpenActions(model.repoId)}
    />
  )
}
