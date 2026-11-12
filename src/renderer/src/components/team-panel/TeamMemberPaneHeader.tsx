import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { StatusDot } from '@/components/StatusDot'
import { translate } from '@/i18n/i18n'
import { teamCiText, teamModelText, teamStatusTone, teamTicketBesideName } from './team-card-text'
import { TeamHostName } from './TeamHostName'
import { useTeamMemberOfTab } from './use-team-panel-model'
import { useTeamPanelLook } from './use-team-panel-look'

/**
 * The native header over a member's terminal tab (ORCA-1048), replacing the mod's member band.
 * Why only while the Team panel is open: that is when its model is read, so it is never stale.
 */
export function TeamMemberPaneHeader({ tabId }: { tabId: string }): React.JSX.Element | null {
  const panelOpen = useAppStore((s) => s.rightSidebarOpen && s.rightSidebarTab === 'team')
  // Why gated before any read: every terminal tab mounts this, and a closed panel reads nothing.
  return panelOpen ? <OpenTeamMemberPaneHeader tabId={tabId} /> : null
}

function OpenTeamMemberPaneHeader({ tabId }: { tabId: string }): React.JSX.Element | null {
  // Why: the terminal tab is memoized; without this a language switch waits for the next poll.
  useTranslation()
  const card = useTeamMemberOfTab(tabId)
  const showName = useTeamPanelLook() === 'game'
  if (!card) {
    return null
  }
  const ci = card.pr ? teamCiText(card.pr) : null
  const ticket = teamTicketBesideName(card, showName)
  const model = teamModelText(card.model)
  return (
    // Why padding inside: a padded box cannot shrink with a center that both sidebars squeeze to 0.
    <div
      data-team-member-header=""
      className="min-w-0 shrink-0 overflow-hidden border-b border-border bg-card text-xs text-muted-foreground"
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone={teamStatusTone(card.status)} />
          {showName ? (
            <span className="truncate font-medium text-foreground">{card.name}</span>
          ) : null}
          {ticket ? <code className="font-mono text-[11.5px]">{ticket}</code> : null}
        </span>
        <span className="font-mono text-[11px]">
          <TeamHostName host={card.host} />
        </span>
        {model ? <span className="truncate">{model}</span> : null}
        {card.pr ? (
          <a
            href={card.pr.url}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
          >
            {`#${card.pr.number}${ci ? ` · ${ci}` : ''}`}
          </a>
        ) : null}
        {card.needsYou ? (
          <span className="ml-auto whitespace-nowrap font-medium text-status-attention">
            {translate('teamPanel.memberHeader.waitingForYou', 'Waiting for you')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
