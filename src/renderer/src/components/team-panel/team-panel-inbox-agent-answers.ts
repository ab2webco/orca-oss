import { useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore, type AppState } from '@/store'

/** An agent-pane question answered from For you: its text and the option picked, nothing else. */
export type TeamInboxAgentAnswer = { question: string; answer: string; scope: string }

// Why a cap: the list lives for the session and only its newest rows are worth a scroll.
const MAX_ANSWERS = 50

// Why memory only: agent status keeps no answered question, and this is the session's record (ORCA-1329 P9).
export const useTeamInboxAgentAnswers = create<{ answers: TeamInboxAgentAnswer[] }>(() => ({
  answers: []
}))

export function recordTeamInboxAgentAnswer(answer: TeamInboxAgentAnswer): void {
  useTeamInboxAgentAnswers.setState((state) => ({
    answers: [answer, ...state.answers].slice(0, MAX_ANSWERS)
  }))
}

/** The project an answer belongs to; a repo on another host is its own entry, the host keeps it apart. */
export function teamInboxAnswerScopeOf(
  state: Pick<AppState, 'getKnownWorktreeById' | 'repos'>,
  worktreeId: string | null
): string | null {
  const repoId = worktreeId ? state.getKnownWorktreeById(worktreeId)?.repoId : null
  const repo = state.repos.find((one) => one.id === repoId)
  return repo ? `${repo.executionHostId ?? repo.connectionId ?? 'local'}|${repo.id}` : null
}

/** Only the answers given in the project shown, on its host (review M1: no other project's rows). */
export function useTeamInboxAgentAnswersHere(): TeamInboxAgentAnswer[] {
  const scope = useAppStore((s) => teamInboxAnswerScopeOf(s, s.activeWorktreeId))
  const answers = useTeamInboxAgentAnswers((s) => s.answers)
  return useMemo(() => answers.filter((one) => one.scope === scope), [answers, scope])
}
