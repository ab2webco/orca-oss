import React from 'react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import type { TeamInboxCounts } from '../../../../shared/team-panel-model-types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabStripEdgeCues, useTabStripCue } from './team-panel-tab-strip-cue'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { GameOwnerQuestionCard } from '@/components/game-inbox/GameOwnerQuestionCard'
import { GameInboxThreadsView } from '@/components/game-inbox/GameInboxThreadsView'
import { GameInboxUndelivered } from '@/components/game-inbox/GameInboxUndelivered'
import { GameMemberOverride } from '@/components/game-inbox/GameMemberReplyForm'
import type { GameMemberReply } from '@/components/game-inbox/game-inbox-threads-client'
import {
  gameInboxTargetOf,
  type GameInboxScope
} from '@/components/game-inbox/game-owner-questions-client'
import { useGameOwnerQuestions } from '@/components/game-inbox/useGameOwnerQuestions'
import { useGameInboxThreads } from '@/components/game-inbox/useGameInboxThreads'
import {
  useOtherGameInboxGroups,
  type GameInboxQuestionGroup
} from '@/components/game-inbox/use-other-game-inbox-groups'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'
import { TeamPanelMessageState } from './team-panel-section-state'
import {
  openTeamInboxAgent,
  teamInboxAgentQuestionsOf,
  type TeamInboxAgentQuestion
} from './team-panel-inbox-agents'
import {
  TeamInboxAgentCard,
  TeamInboxAnsweredRows,
  TeamInboxWaitingRows
} from './team-panel-inbox-items'

type InboxSubTab = 'for-you' | 'waiting' | 'threads' | 'answered'

const SUB_TAB =
  'h-[26px] flex-none gap-1 rounded-md px-1.5 text-xs font-medium data-[state=active]:bg-muted data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted'
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
  /** Answers the board still holds because no lead took them yet. */
  undelivered: GameOwnerQuestion[]
  onAnswer: (id: string, reply: GameOwnerReply) => Promise<void>
  otherGroups: GameInboxQuestionGroup[]
  threads: GameInboxThreads
  onReply: (reply: GameMemberReply) => Promise<void>
  /** Sessions blocked on a question, read from agent status when there is no team. */
  agentQuestions: TeamInboxAgentQuestion[]
  /** This project's questions you already answered, newest first. */
  answeredQuestions: GameOwnerQuestion[]
  onOpenAgent: (question: TeamInboxAgentQuestion) => void
  /** Each member's character name by ticket, so a waiting question says who asks. */
  memberNames: ReadonlyMap<string, string>
}

/** The full questions live only here: For you across projects and hosts, then the lead's mail. */
export function TeamInboxView(props: TeamInboxViewProps): React.JSX.Element {
  const { questions, otherGroups, threads, onReply, agentQuestions, answeredQuestions } = props
  const [tab, setTab] = React.useState<InboxSubTab>('for-you')
  const forYou =
    agentQuestions.length +
    questions.length +
    otherGroups.reduce((sum, group) => sum + group.questions.length, 0)
  const subTabs: [InboxSubTab, string, number][] = [
    ['for-you', translate('teamPanel.inbox.forYou', 'For you'), forYou],
    ['waiting', translate('teamPanel.inbox.waiting', 'Waiting'), threads.waiting.length],
    ['threads', translate('teamPanel.inbox.threads', 'Threads'), threads.threads.length],
    [
      'answered',
      translate('teamPanel.inbox.answered', 'Answered'),
      threads.answered.length + answeredQuestions.length
    ]
  ]
  // Why short: the panel can be about 200 px wide, where a longer placeholder is cut.
  const yourAnswer = translate('teamPanel.inbox.yourAnswer', 'Your answer')
  const reply = (item: { id: string; ticket: string }) => (text: string) =>
    onReply({ id: item.id, text, ticket: item.ticket })
  const nothing = subTabs.every(([, , count]) => count === 0) && props.undelivered.length === 0
  const empty = nothing && !props.projectUnread
  // Why empty in the key: the strip mounts when the first item arrives, with the same tab selected.
  const cue = useTabStripCue(tab, empty ? '' : subTabs.map(([id]) => id).join())
  if (empty) {
    return (
      <TeamPanelMessageState
        title={translate('teamPanel.tabs.inbox.emptyTitle', 'Nothing waits for you')}
        text={translate(
          'teamPanel.tabs.inbox.emptyText',
          'When an agent asks you something, it shows here.'
        )}
      />
    )
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as InboxSubTab)}
      className="flex h-full min-h-0 flex-col gap-0"
      data-testid="team-panel-inbox"
    >
      {/* Why one line: V28 keeps the sub-tabs on one row; a narrow panel scrolls them with a cue. */}
      <div className="relative shrink-0">
        <TabsList
          aria-label={translate('teamPanel.inbox.sections', 'Inbox sections')}
          {...cue.stripProps}
          className="h-auto w-full shrink-0 flex-nowrap justify-start overflow-x-auto group-data-[orientation=horizontal]/tabs:h-auto gap-1 rounded-none bg-transparent px-3 pt-2.5 pb-2 [scrollbar-width:none]"
        >
          {subTabs.map(([id, label, count]) => (
            <TabsTrigger
              key={id}
              ref={id === tab ? cue.activeTrigger : undefined}
              value={id}
              className={SUB_TAB}
            >
              {label}
              <span className="tabular-nums">{count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabStripEdgeCues overflow={cue.overflow} />
      </div>
      <TabsContent value="for-you" className={`${LIST} space-y-2`}>
        <GameInboxUndelivered questions={props.undelivered} />
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
        {agentQuestions.map((question) => (
          <TeamInboxAgentCard
            key={question.paneKey}
            question={question}
            onOpen={props.onOpenAgent}
          />
        ))}
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
                placeholder={yourAnswer}
                needsYou
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
                placeholder={yourAnswer}
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
        <TeamInboxWaitingRows
          items={threads.waiting}
          memberNames={props.memberNames}
          now={Date.now()}
          renderActions={(item) => (
            <GameMemberOverride
              id={item.id}
              ticket={item.ticket}
              placeholder={yourAnswer}
              label={translate('teamPanel.inbox.answer', 'Answer')}
              onReply={reply(item)}
            />
          )}
        />
      </TabsContent>
      <TabsContent value="threads" className="mt-0 flex min-h-0 flex-1 flex-col">
        <GameInboxThreadsView threads={threads.threads} />
      </TabsContent>
      <TabsContent value="answered" className={LIST}>
        <TeamInboxAnsweredRows
          yours={answeredQuestions}
          lead={threads.answered}
          now={Date.now()}
          renderOverride={(item) => (
            <GameMemberOverride
              id={item.id}
              ticket={item.ticket}
              placeholder={yourAnswer}
              onReply={reply(item)}
            />
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
  const projectName = useAppStore((s) => {
    const repoId = s.activeWorktreeId ? s.getKnownWorktreeById(s.activeWorktreeId)?.repoId : null
    return s.repos.find((repo) => repo.id === repoId)?.displayName ?? ''
  })
  const read = useGameOwnerQuestions(scope, { all: true })
  const { open, answered } = React.useMemo(() => {
    const done = read.questions.filter((one) => one.answer)
    done.sort((a, b) => (b.answer?.at ?? '').localeCompare(a.answer?.at ?? ''))
    return { open: read.questions.filter((one) => !one.answer), answered: done }
  }, [read.questions])
  // Why open: the tab follows every message while it is shown.
  const threads = useGameInboxThreads(scope, true)
  const otherGroups = useOtherGameInboxGroups()
  const memberNames = React.useMemo(
    () =>
      new Map(
        model.kind === 'team'
          ? model.members.flatMap((one) => (one.ticket ? [[one.ticket.identifier, one.name]] : []))
          : []
      ),
    [model]
  )
  return (
    <TeamInboxView
      projectName={model.kind === 'team' ? model.projectName : projectName}
      projectUnread={value.projectUnread ?? null}
      questions={open}
      undelivered={read.undelivered}
      onAnswer={read.answer}
      otherGroups={otherGroups}
      threads={threads}
      onReply={threads.reply}
      agentQuestions={teamInboxAgentQuestionsOf(model)}
      answeredQuestions={answered}
      onOpenAgent={openTeamInboxAgent}
      memberNames={memberNames}
    />
  )
}
