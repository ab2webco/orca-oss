import React from 'react'
import { Inbox } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { gameInboxTargetOf, type GameInboxScope } from './game-owner-questions-client'
import { useGameOwnerQuestions } from './useGameOwnerQuestions'
import { useGameInboxThreads } from './useGameInboxThreads'
import { GameInboxSheet } from './GameInboxSheet'
import { useGameInboxAppState } from './game-inbox-app-state'
import { openQuestionCountOf, useOtherGameInboxGroups } from './use-other-game-inbox-groups'

/** Sidebar entry for the Inbox: shown while the lead asks the person something in any project or this one has a team; counts only For you. */
export function SidebarGameInboxEntry(): React.JSX.Element | null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const scope = React.useMemo<GameInboxScope | null>(
    () => (worktreeId ? { target: gameInboxTargetOf(hostId), worktreeId } : null),
    [worktreeId, hostId]
  )
  const { questions, answer } = useGameOwnerQuestions(scope)
  const open = useGameInboxAppState((s) => s.open)
  const setOpen = useGameInboxAppState((s) => s.setOpen)
  const threads = useGameInboxThreads(scope, open)

  const otherGroups = useOtherGameInboxGroups()
  const count = questions.length + openQuestionCountOf(otherGroups)

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
