import type { TeamPanelModel, TeamSessionRef } from '../../../../shared/team-panel-model-types'
import { openTeamSession } from './team-session-open'

/** An agent session blocked on a question to the user, as its AgentStatusEntry reports it. */
export type TeamInboxAgentQuestion = TeamSessionRef & {
  repoName: string
  worktreeName: string
  text: string
  options: string[]
}

/** With no team, the Inbox reads each session's live question; with a team, the lead's board. */
export function teamInboxAgentQuestionsOf(model: TeamPanelModel): TeamInboxAgentQuestion[] {
  if (model.kind !== 'solo') {
    return []
  }
  return model.rows.flatMap((row) =>
    row.liveAction?.kind === 'question'
      ? [
          {
            paneKey: row.paneKey,
            terminalHandle: row.terminalHandle,
            worktreeId: row.worktreeId,
            host: row.host,
            repoName: row.repoName,
            worktreeName: row.worktreeName,
            text: row.liveAction.text,
            options: row.liveAction.options
          }
        ]
      : []
  )
}

// Why open the terminal: answering a live prompt from a row is still an open owner decision.
export function openTeamInboxAgent(question: TeamInboxAgentQuestion): void {
  void openTeamSession(question, question.worktreeName)
}
