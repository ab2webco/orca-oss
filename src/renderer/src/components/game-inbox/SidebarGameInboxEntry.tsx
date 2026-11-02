import React from 'react'
import { Inbox } from 'lucide-react'
import type { GameOwnerReply } from '../../../../shared/orchestrator-game-owner-questions'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  answerGameOwnerQuestion,
  gameInboxTargetOf,
  type GameInboxScope
} from './game-owner-questions-client'
import { useGameOwnerQuestions } from './useGameOwnerQuestions'
import { useGameInboxThreads } from './useGameInboxThreads'
import { GameInboxSheet, type GameInboxQuestionGroup } from './GameInboxSheet'
import { useGameInboxAppState } from './game-inbox-app-state'
import { environmentIdOfHost, otherGameOwnerQuestionGroups } from './game-owner-question-groups'
import { signalGameOwnerQuestionsChanged } from './game-owner-questions-signal'

/** Sidebar entry for the Inbox: shown while the lead asks the person something in any project or this one has a team; counts only For you. */
export function SidebarGameInboxEntry(): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const environments = useAppStore((s) => s.runtimeEnvironments)
  const scope = React.useMemo<GameInboxScope | null>(
    () => (worktreeId ? { target: gameInboxTargetOf(hostId), worktreeId } : null),
    [worktreeId, hostId]
  )
  const { questions, answer } = useGameOwnerQuestions(scope)
  const hosts = useGameInboxAppState((s) => s.hosts)
  const open = useGameInboxAppState((s) => s.open)
  const setOpen = useGameInboxAppState((s) => s.setOpen)
  const threads = useGameInboxThreads(scope, open)

  const otherGroups = React.useMemo<GameInboxQuestionGroup[]>(
    () =>
      otherGameOwnerQuestionGroups(hosts, {
        worktreeId: worktreeId ?? null,
        environmentId: environmentIdOfHost(hostId)
      }).map(({ environmentId, project }) => {
        const host = environmentId
          ? (environments.find((one) => one.id === environmentId)?.name ?? null)
          : null
        const target: GameInboxScope['target'] = environmentId
          ? { kind: 'environment', environmentId }
          : { kind: 'local' }
        return {
          key: `${environmentId ?? 'local'}\u0000${project.repoId}`,
          title: project.repoName,
          host,
          questions: project.questions,
          onAnswer: async (id: string, reply: GameOwnerReply) => {
            if (!project.worktreeId) {
              throw new Error(
                translate(
                  'auto.components.game-inbox.SidebarGameInboxEntry.noWorktree',
                  'Open this project in Orca to answer.'
                )
              )
            }
            await answerGameOwnerQuestion({ target, worktreeId: project.worktreeId }, id, reply)
            signalGameOwnerQuestionsChanged()
          }
        }
      }),
    [hosts, worktreeId, hostId, environments]
  )
  const count =
    questions.length + otherGroups.reduce((sum, group) => sum + group.questions.length, 0)

  if (count === 0 && threads.threads.length === 0 && !open) {
    return null
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid="game-inbox-entry"
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
          open
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
        )}
      >
        <Inbox
          className={cn('size-4 shrink-0', !open && 'text-worktree-sidebar-foreground/30')}
          strokeWidth={open ? 2.25 : 1.75}
        />
        <span className="flex-1">
          {translate('auto.components.game-inbox.SidebarGameInboxEntry.inbox', 'Inbox')}
        </span>
        {count > 0 ? (
          <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </button>
      <GameInboxSheet
        open={open}
        onOpenChange={setOpen}
        questions={questions}
        onAnswer={answer}
        otherGroups={otherGroups}
        threads={threads}
        onReply={threads.reply}
      />
    </>
  )
}
