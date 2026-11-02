import { useEffect } from 'react'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import type { GameInboxNotificationTarget } from '../../../../shared/notification-settings-types'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useGameInboxAppState } from './game-inbox-app-state'
import {
  newGameOwnerQuestions,
  openGameOwnerQuestionCount,
  readGameOwnerQuestionsOfHost,
  type GameOwnerQuestionHost
} from './game-owner-questions-across-hosts'
import { environmentIdOfHost, isActiveGameProject } from './game-owner-question-groups'
import { onGameOwnerQuestionsChanged } from './game-owner-questions-signal'

function reachableEnvironmentKey(): string {
  const ids: string[] = []
  for (const [environmentId, status] of useAppStore.getState().runtimeStatusByEnvironmentId ?? []) {
    if (status?.status) {
      ids.push(environmentId)
    }
  }
  return ids.sort().join('\u0000')
}

// Why keep a failed host's last read: an offline host must not drop its questions from the count.
async function readAllHosts(
  environmentIds: readonly string[],
  previous: readonly GameOwnerQuestionHost[]
): Promise<GameOwnerQuestionHost[]> {
  const targets: (string | null)[] = [null, ...environmentIds]
  const reads = await Promise.allSettled(targets.map((id) => readGameOwnerQuestionsOfHost(id)))
  return reads.flatMap((read, index) => {
    if (read.status === 'fulfilled') {
      return [read.value]
    }
    const kept = previous.find((host) => host.environmentId === targets[index])
    return kept ? [kept] : []
  })
}

function announce(hosts: readonly GameOwnerQuestionHost[], next: GameOwnerQuestionHost[]): void {
  const state = useAppStore.getState()
  const active = {
    worktreeId: state.activeWorktreeId ?? null,
    environmentId: environmentIdOfHost(state.activeWorkspaceExecutionHostId)
  }
  for (const { environmentId, project, question } of newGameOwnerQuestions(hosts, next)) {
    void window.api.notifications.dispatch({
      source: 'game-owner-question',
      notificationId: `game-owner-question:${question.id}`,
      repoLabel: project.repoName,
      ownerQuestion: question.question,
      isActiveWorktree: isActiveGameProject({ environmentId, project }, active),
      gameInbox: { environmentId, worktreeId: project.worktreeId }
    })
  }
}

function openInboxAt(target: GameInboxNotificationTarget): void {
  const state = useAppStore.getState()
  if (target.worktreeId && state.getKnownWorktreeById(target.worktreeId)) {
    activateAndRevealWorktree(
      target.worktreeId,
      target.environmentId
        ? { executionHostId: toRuntimeExecutionHostId(target.environmentId) }
        : undefined
    )
  }
  state.setSidebarOpen(true)
  useGameInboxAppState.getState().setOpen(true)
}

/** Keeps every host's open owner questions, the dock count and a notification per new question. */
export function GameOwnerQuestionsWatcher(): null {
  const environmentKey = useAppStore(() => reachableEnvironmentKey())

  useEffect(() => {
    const environmentIds = environmentKey ? environmentKey.split('\u0000') : []
    let disposed = false
    let seq = 0
    const refresh = async (): Promise<void> => {
      const mine = ++seq
      const previous = useGameInboxAppState.getState().hosts
      const next = await readAllHosts(environmentIds, previous)
      // Why: a slower earlier read must not overwrite a later one.
      if (disposed || mine !== seq) {
        return
      }
      announce(useGameInboxAppState.getState().hosts, next)
      useGameInboxAppState.getState().setHosts(next)
      void window.api.notifications.setBadgeCount(openGameOwnerQuestionCount(next))
    }
    const refreshNow = (): void => void refresh()
    refreshNow()
    const stopLocal = window.api.runtime.onGameOwnerQuestionsChanged?.(refreshNow)
    const stopPaired = onGameOwnerQuestionsChanged(refreshNow)
    window.addEventListener('focus', refreshNow)
    return () => {
      disposed = true
      stopLocal?.()
      stopPaired()
      window.removeEventListener('focus', refreshNow)
    }
  }, [environmentKey])

  useEffect(() => window.api.notifications.onOpenGameInbox(openInboxAt), [])

  return null
}
