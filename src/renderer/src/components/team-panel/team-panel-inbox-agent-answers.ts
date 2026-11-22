import { create } from 'zustand'

/** An agent-pane question answered from For you: its text and the option picked, nothing else. */
export type TeamInboxAgentAnswer = { question: string; answer: string }

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
