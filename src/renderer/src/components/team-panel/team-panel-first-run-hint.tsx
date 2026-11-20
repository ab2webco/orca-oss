import { translate } from '@/i18n/i18n'

// Why constants: slash commands are typed as is in every language.
const SETUP_COMMAND = '/orca-game:setup'
const LEAD_COMMAND = '/orca-game:lead'

const Command = ({ text }: { text: string }): React.JSX.Element => (
  <code className="font-mono text-[11px] text-foreground">{text}</code>
)

/** How to start a team, for a project where no lead runs yet (ORCA-1304). */
export function TeamFirstRunHint(): React.JSX.Element {
  return (
    <div
      data-team-first-run=""
      className="space-y-1 border-b border-border px-3 py-2 text-xs text-muted-foreground"
    >
      <p className="font-medium text-foreground">
        {translate('teamPanel.firstRun.title', 'Start a team')}
      </p>
      <ol className="list-decimal space-y-0.5 pl-4">
        <li>
          <Command text={SETUP_COMMAND} />{' '}
          {translate(
            'teamPanel.firstRun.setup',
            "in a Claude session here names your lead and sets up the project's game."
          )}
        </li>
        <li>
          <Command text={LEAD_COMMAND} />{' '}
          {translate(
            'teamPanel.firstRun.lead',
            'starts the lead. Give it a ticket: it launches one member per ticket.'
          )}
        </li>
      </ol>
    </div>
  )
}
