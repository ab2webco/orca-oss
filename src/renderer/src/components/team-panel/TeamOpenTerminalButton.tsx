import { SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { TeamSessionRef } from '../../../../shared/team-panel-model-types'
import { openTeamSession } from './team-session-open'
import { teamHostWorktreeMissing } from './team-session-host-worktree'

/** Why this window cannot open the session's terminal; null when it can. */
export function teamOpenTerminalBlock(
  session: TeamSessionRef,
  hostWorktreeMissing: boolean
): string | null {
  if (!session.terminalHandle && !session.worktreeId) {
    return translate('teamPanel.card.noTerminal', 'This agent has no terminal to open yet.')
  }
  return hostWorktreeMissing
    ? translate(
        'teamPanel.card.detail.hostWorktreeMissing',
        "Add the host's repository to this window to open its terminal."
      )
    : null
}

/** The card's only way into its terminal; a click on the card itself just folds or unfolds it. */
export function TeamOpenTerminalButton({
  session,
  name
}: {
  session: TeamSessionRef
  name: string
}): React.JSX.Element {
  const hostWorktreeMissing = useAppStore((state) =>
    teamHostWorktreeMissing(session, state.getKnownWorktreeById)
  )
  const blocked = teamOpenTerminalBlock(session, hostWorktreeMissing)
  const label = translate('teamPanel.card.openTerminal', 'Open terminal')
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Why aria-disabled, not disabled: a disabled button gets no hover, so its reason never shows. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-team-open-terminal=""
            aria-label={label}
            aria-disabled={blocked ? true : undefined}
            className={cn(
              'size-5 text-muted-foreground hover:text-foreground',
              blocked &&
                'cursor-default opacity-50 hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent'
            )}
            onClick={() => {
              if (!blocked) {
                void openTeamSession(session, name)
              }
            }}
          >
            <SquareTerminal aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4} className="max-w-60">
          {blocked ?? label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
