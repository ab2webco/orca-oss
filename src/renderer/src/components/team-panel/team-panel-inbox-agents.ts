import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TeamHost, TeamPanelModel } from '../../../../shared/team-panel-model-types'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'

/** An agent session blocked on a question to the user, as its AgentStatusEntry reports it. */
export type TeamInboxAgentQuestion = {
  paneKey: string
  worktreeId: string | null
  host: TeamHost
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
  const parsed = parsePaneKey(question.paneKey)
  if (!question.worktreeId || !parsed) {
    return
  }
  const environmentId = question.host.kind === 'remote' ? question.host.environmentId : null
  activateAndRevealWorktree(
    question.worktreeId,
    environmentId ? { executionHostId: toRuntimeExecutionHostId(environmentId) } : undefined
  )
  activateTabAndFocusPane(parsed.tabId, parsed.leafId, { flashFocusedPane: true })
}
