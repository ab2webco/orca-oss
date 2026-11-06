import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import { Button } from '@/components/ui/button'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'
import { teamHostText } from './team-card-text'
import type { TeamInboxAgentQuestion } from './team-panel-inbox-agents'

/** A session blocked on the user; its options are shown, answered in its own terminal. */
export function TeamInboxAgentCard({
  question,
  onOpen
}: {
  question: TeamInboxAgentQuestion
  onOpen: (question: TeamInboxAgentQuestion) => void
}): React.JSX.Element {
  const place = [question.repoName, question.worktreeName]
  if (question.host.kind === 'remote') {
    place.push(teamHostText(question.host))
  }
  return (
    <article
      data-team-inbox-agent={question.paneKey}
      className="space-y-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <p className="truncate text-xs text-muted-foreground">{place.join(' · ')}</p>
      <p className="text-sm break-words whitespace-pre-wrap">{question.text}</p>
      {question.options.length > 0 ? (
        <p className="text-xs break-words text-muted-foreground">{question.options.join(' · ')}</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!question.worktreeId}
        onClick={() => onOpen(question)}
      >
        {translate('teamPanel.inbox.openTerminal', 'Open terminal')}
      </Button>
    </article>
  )
}

/** What the person answered the lead, newest first. */
export function TeamInboxYouAnsweredList({
  questions
}: {
  questions: GameOwnerQuestion[]
}): React.JSX.Element {
  return (
    <ul className="space-y-3">
      {questions.map((question) => (
        <li
          key={question.id}
          data-team-inbox-answered={question.id}
          className="space-y-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {question.ticket ? (
              <span className="shrink-0 font-mono font-medium text-foreground">
                {question.ticket}
              </span>
            ) : null}
            {question.answer ? (
              <span className="truncate">{formatUiRelativeTimeFromDate(question.answer.at)}</span>
            ) : null}
          </div>
          <p className="text-sm break-words whitespace-pre-wrap">{question.question}</p>
          <p className="border-l-2 border-border pl-3 text-sm break-words whitespace-pre-wrap text-muted-foreground">
            {translate('teamPanel.inbox.youAnsweredText', 'You answered: {{text}}', {
              text: question.answer?.text ?? ''
            })}
          </p>
        </li>
      ))}
    </ul>
  )
}
