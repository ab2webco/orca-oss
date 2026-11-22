import { useMemo } from 'react'
import { create } from 'zustand'
import { useTeamPanelScopeKey } from './use-team-panel-model'

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

/** Only the answers given from the panel shown (review M1, N2): a held team keeps its members' answers. */
export function useTeamInboxAgentAnswersHere(): TeamInboxAgentAnswer[] {
  const scope = useTeamPanelScopeKey()
  const answers = useTeamInboxAgentAnswers((s) => s.answers)
  return useMemo(() => answers.filter((one) => one.scope === scope), [answers, scope])
}
