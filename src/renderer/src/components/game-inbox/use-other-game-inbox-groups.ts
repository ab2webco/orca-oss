import React from 'react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { answerGameOwnerQuestion, type GameInboxScope } from './game-owner-questions-client'
import { useGameInboxAppState } from './game-inbox-app-state'
import { openGameOwnerQuestionCount } from './game-owner-questions-across-hosts'
import { environmentIdOfHost, otherGameOwnerQuestionGroups } from './game-owner-question-groups'
import { signalGameOwnerQuestionsChanged } from './game-owner-questions-signal'

/** Another project's open questions, answered through that project's worktree. */
export type GameInboxQuestionGroup = {
  key: string
  title: string
  /** The paired host's name; null on this computer. */
  host: string | null
  questions: GameOwnerQuestion[]
  onAnswer: (id: string, reply: GameOwnerReply) => Promise<void>
}

/** Every other project's and host's open questions, each answered through its own worktree. */
export function useOtherGameInboxGroups(): GameInboxQuestionGroup[] {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const environments = useAppStore((s) => s.runtimeEnvironments)
  const hosts = useGameInboxAppState((s) => s.hosts)
  return React.useMemo(
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
}

/** Every project's open questions on every host, the active project's included. */
export function useOpenGameOwnerQuestionCount(): number {
  return useGameInboxAppState((s) => openGameOwnerQuestionCount(s.hosts))
}

export function openQuestionCountOf(groups: readonly GameInboxQuestionGroup[]): number {
  return groups.reduce((sum, group) => sum + group.questions.length, 0)
}
