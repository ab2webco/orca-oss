import React from 'react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import type { TeamInboxCounts } from '../../../../shared/team-panel-model-types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { GameOwnerQuestionCard } from '@/components/game-inbox/GameOwnerQuestionCard'
import { GameInboxWaitingList } from '@/components/game-inbox/GameInboxWaitingList'
import { GameInboxAnsweredList } from '@/components/game-inbox/GameInboxAnsweredList'
import { GameInboxThreadsView } from '@/components/game-inbox/GameInboxThreadsView'
import {
  GameMemberOverride,
  GameMemberReplyForm
} from '@/components/game-inbox/GameMemberReplyForm'
import type { GameInboxQuestionGroup } from '@/components/game-inbox/GameInboxSheet'
import type { GameMemberReply } from '@/components/game-inbox/game-inbox-threads-client'
import {
  gameInboxTargetOf,
  type GameInboxScope
} from '@/components/game-inbox/game-owner-questions-client'
import { useGameOwnerQuestions } from '@/components/game-inbox/useGameOwnerQuestions'
import { useGameInboxThreads } from '@/components/game-inbox/useGameInboxThreads'
import { useOtherGameInboxGroups } from '@/components/game-inbox/use-other-game-inbox-groups'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

type InboxSubTab = 'for-you' | 'waiting' | 'threads' | 'answered'

const SUB_TAB =
  'h-[26px] flex-none rounded-md px-2 text-xs font-medium data-[state=active]:bg-muted data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted'
const LIST = 'mt-0 px-3 pb-4'

function GroupLabel({ title, place }: { title: string; place: string | null }): React.JSX.Element {
  return (
    <h3 className="truncate pt-2 pb-1.5 text-xs font-medium text-muted-foreground">
      {place ? `${title} · ${place}` : title}
    </h3>
  )
}

export type TeamInboxViewProps = {
  projectName: string
  /** Set when this project's own questions were not read; other projects still show. */
  projectUnread: { message: string | null } | null
  questions: GameOwnerQuestion[]
  onAnswer: (id: string, reply: GameOwnerReply) => Promise<void>
  otherGroups: GameInboxQuestionGroup[]
  threads: GameInboxThreads
  onReply: (reply: GameMemberReply) => Promise<void>
}

/** The full questions live only here: For you across projects and hosts, then the lead's mail. */
export function TeamInboxView(props: TeamInboxViewProps): React.JSX.Element {
  const { questions, otherGroups, threads, onReply } = props
  const [tab, setTab] = React.useState<InboxSubTab>('for-you')
  const forYou =
    questions.length + otherGroups.reduce((sum, group) => sum + group.questions.length, 0)
  const subTabs: [InboxSubTab, string, number][] = [
    ['for-you', translate('teamPanel.inbox.forYou', 'For you'), forYou],
    ['waiting', translate('teamPanel.inbox.waiting', 'Waiting'), threads.waiting.length],
    ['threads', translate('teamPanel.inbox.threads', 'Threads'), threads.threads.length],
    ['answered', translate('teamPanel.inbox.answered', 'Answered'), threads.answered.length]
  ]
  const reply = (item: { id: string; ticket: string }) => (text: string) =>
    onReply({ id: item.id, text, ticket: item.ticket })
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as InboxSubTab)}
      className="flex h-full min-h-0 flex-col gap-0"
      data-testid="team-panel-inbox"
    >
      <TabsList
        aria-label={translate('teamPanel.inbox.sections', 'Inbox sections')}
        className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-3 pt-2.5 pb-2 [scrollbar-width:none]"
      >
        {subTabs.map(([id, label, count]) => (
          <TabsTrigger key={id} value={id} className={SUB_TAB}>
            {label}
            <span className="tabular-nums">{count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="for-you" className={`${LIST} space-y-2`}>
        {/* Why only with none read: the tab's own read may succeed where the model's failed. */}
        {props.projectUnread && questions.length === 0 ? (
          <div role="status" className="space-y-1 pt-2 text-xs text-muted-foreground">
            <p className="font-medium text-destructive">
              {translate(
                'teamPanel.inbox.projectUnread',
                "Could not read this project's questions."
              )}
            </p>
            {props.projectUnread.message ? (
              <p className="break-words">{props.projectUnread.message}</p>
            ) : null}
          </div>
        ) : null}
        {questions.length > 0 ? (
          <section className="space-y-2" data-team-inbox-project="active">
            <GroupLabel
              title={props.projectName}
              place={translate('teamPanel.inbox.thisProject', 'this project')}
            />
            {questions.map((question) => (
              <GameOwnerQuestionCard
                key={question.id}
                question={question}
                onAnswer={(answer) => props.onAnswer(question.id, answer)}
              />
            ))}
          </section>
        ) : null}
        {otherGroups.map((group) => (
          <section key={group.key} className="space-y-2" data-team-inbox-project={group.key}>
            <GroupLabel title={group.title} place={group.host} />
            {group.questions.map((question) => (
              <GameOwnerQuestionCard
                key={question.id}
                question={question}
                onAnswer={(answer) => group.onAnswer(question.id, answer)}
              />
            ))}
          </section>
        ))}
        {forYou === 0 && !props.projectUnread ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {translate('teamPanel.inbox.forYouEmpty', 'No questions are waiting for you.')}
          </p>
        ) : null}
      </TabsContent>
      <TabsContent value="waiting" className={LIST}>
        <GameInboxWaitingList
          items={threads.waiting}
          renderActions={(item) => (
            <GameMemberReplyForm
              id={item.id}
              ticket={item.ticket}
              placeholder={translate(
                'auto.components.game-inbox.GameInboxSheet.answerInstead',
                'Answer instead of the lead'
              )}
              onReply={reply(item)}
            />
          )}
        />
      </TabsContent>
      <TabsContent value="threads" className="mt-0 flex min-h-0 flex-1 flex-col">
        <GameInboxThreadsView threads={threads.threads} />
      </TabsContent>
      <TabsContent value="answered" className={LIST}>
        <GameInboxAnsweredList
          items={threads.answered}
          renderActions={(item) => (
            <GameMemberOverride id={item.id} ticket={item.ticket} onReply={reply(item)} />
          )}
        />
      </TabsContent>
    </Tabs>
  )
}

export function TeamPanelInboxTab({
  value,
  model
}: TeamPanelTabBodyProps<TeamInboxCounts>): React.JSX.Element {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const scope = React.useMemo<GameInboxScope | null>(
    () => (worktreeId ? { target: gameInboxTargetOf(hostId), worktreeId } : null),
    [worktreeId, hostId]
  )
  const { questions, answer } = useGameOwnerQuestions(scope)
  // Why open: the tab follows every message while it is shown, as the Sheet did when open.
  const threads = useGameInboxThreads(scope, true)
  const otherGroups = useOtherGameInboxGroups()
  return (
    <TeamInboxView
      projectName={model.kind === 'team' ? model.projectName : ''}
      projectUnread={value.projectUnread ?? null}
      questions={questions}
      onAnswer={answer}
      otherGroups={otherGroups}
      threads={threads}
      onReply={threads.reply}
    />
  )
}
