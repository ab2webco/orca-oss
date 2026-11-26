import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { gameRemovePromptOf } from '../../../../shared/orchestrator-game-remove-target'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { useTeamLeadPrompt } from './use-team-lead-prompt'

/** The card's Remove: asks first, then has the lead run `orca game remove` on this member alone (ORCA-1476). */
export function TeamMemberRemoveAction({
  card
}: {
  card: Pick<TeamMemberCard, 'paneKey' | 'name' | 'condition'>
}): React.JSX.Element | null {
  const send = useTeamLeadPrompt()
  const [confirming, setConfirming] = useState(false)
  // Why hidden: with no lead pane nothing would run it, and a paused or queued card is a saved record, not a fleet row.
  if (!send || card.condition === 'paused' || card.condition === 'queued') {
    return null
  }
  const label = translate('teamPanel.card.remove', 'Remove')
  if (!confirming) {
    return (
      <Button
        data-team-remove=""
        variant="ghost"
        size="xs"
        className="w-max text-muted-foreground"
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    )
  }
  return (
    <div data-team-remove-confirm="" role="group" className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-[1_1_140px] break-words text-foreground">
        {translate(
          'teamPanel.card.removeConfirm',
          'Remove {{name}}? Orca stops its session if it runs, otherwise forgets it. No other member is touched.',
          { name: card.name }
        )}
      </span>
      <Button
        variant="destructive"
        size="xs"
        onClick={() => {
          setConfirming(false)
          void send(`remove:${card.paneKey}`, gameRemovePromptOf(card), `${label} ${card.name}`)
        }}
      >
        {label}
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        {translate('teamPanel.card.removeCancel', 'Cancel')}
      </Button>
    </div>
  )
}
