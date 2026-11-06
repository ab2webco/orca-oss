import { translate } from '@/i18n/i18n'
import { GAME_LEAD_ACTIONS } from '../../../../shared/orchestrator-game-lead-actions'
import type { GameOrcaActionId } from '../../../../shared/orchestrator-game-orca-actions'
import type { TeamAction, TeamActionOff } from '../../../../shared/team-panel-actions'

const DEFAULT_LABELS = new Map(GAME_LEAD_ACTIONS.map((one) => [one.command, one.label]))

function orcaLabel(id: GameOrcaActionId): string {
  switch (id) {
    case 'wave':
      return translate('teamPanel.actions.wave', 'Wave')
    case 'status':
      return translate('teamPanel.actions.status', 'Status')
    case 'push':
      return translate('teamPanel.actions.push', 'Push')
    case 'sweep':
      return translate('teamPanel.actions.sweep', 'Sweep')
    case 'stop':
      return translate('teamPanel.actions.stop', 'Stop')
  }
}

/** Orca's own in the app language; a label the project wrote stays as written. */
export function teamActionLabel(action: Pick<TeamAction, 'orca' | 'label'>): string {
  return action.orca && action.label === DEFAULT_LABELS.get(action.orca)
    ? orcaLabel(action.orca)
    : action.label
}

export function teamActionOffText(off: TeamActionOff): string {
  switch (off) {
    case 'stopped':
      return translate('teamPanel.actions.off.stopped', 'A STOP is on')
    case 'nothingToDo':
      return translate('teamPanel.actions.off.nothingToDo', 'Nothing to do')
    case 'nobodyStopped':
      return translate('teamPanel.actions.off.nobodyStopped', 'Nobody stopped')
    case 'nothingToClose':
      return translate('teamPanel.actions.off.nothingToClose', 'Nothing to close')
    case 'alreadyStopped':
      return translate('teamPanel.actions.off.alreadyStopped', 'Already stopped')
    case 'noNativePath':
      return translate('teamPanel.actions.off.noNativePath', 'Runs from the terminal')
  }
}

/** Why it shows now, with its count; else what it sends. */
export function teamActionHint(action: TeamAction): string {
  const count = action.now?.count
  if (count !== undefined) {
    switch (action.orca) {
      case 'wave':
        return translate('teamPanel.actions.why.wave', '{{count}} to do, slots free', { count })
      case 'push':
        return translate('teamPanel.actions.why.push', '{{count}} stopped', { count })
      case 'sweep':
        return translate('teamPanel.actions.why.sweep', '{{count}} finished to close', { count })
    }
  }
  return action.send ?? ''
}
