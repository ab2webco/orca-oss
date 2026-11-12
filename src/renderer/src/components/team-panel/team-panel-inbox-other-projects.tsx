import React from 'react'
import { ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { GameOwnerQuestionCard } from '@/components/game-inbox/GameOwnerQuestionCard'
import type { GameInboxQuestionGroup } from '@/components/game-inbox/use-other-game-inbox-groups'

export function TeamInboxGroupLabel({
  title,
  place
}: {
  title: string
  place: string | null
}): React.JSX.Element {
  return (
    <h3 className="truncate pt-2 pb-1.5 text-xs font-medium text-muted-foreground">
      {place ? `${title} · ${place}` : title}
    </h3>
  )
}

/** Other projects' and hosts' questions, folded under one heading so they never read as this one's. */
export function TeamInboxOtherProjects({
  groups,
  placeholder
}: {
  groups: GameInboxQuestionGroup[]
  placeholder: string
}): React.JSX.Element | null {
  const count = groups.reduce((sum, group) => sum + group.questions.length, 0)
  if (count === 0) {
    return null
  }
  return (
    <Collapsible className="group/others" data-team-inbox-project="others">
      <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm pt-2 pb-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform motion-reduce:transition-none group-data-[state=open]/others:rotate-90"
        />
        <span className="truncate">{translate('teamPanel.inbox.otherProjects', 'Other projects')}</span>
        <span className="tabular-nums">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        {groups.map((group) => (
          <section key={group.key} className="space-y-2" data-team-inbox-group={group.key}>
            <TeamInboxGroupLabel title={group.title} place={group.host} />
            {group.questions.map((question) => (
              <GameOwnerQuestionCard
                key={question.id}
                question={question}
                placeholder={placeholder}
                onAnswer={(answer) => group.onAnswer(question.id, answer)}
              />
            ))}
          </section>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
