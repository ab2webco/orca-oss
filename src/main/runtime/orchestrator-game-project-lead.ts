import type { GameBoardProject } from './orchestrator-game-board'

/** The person's Inbox calls with a worktree, never a terminal: its lead is the project's live one. */
export async function withProjectLead(
  project: GameBoardProject,
  liveLeadOf: (projectKey: string) => Promise<string | null>,
  paneOf: (handle: string) => string | null
): Promise<GameBoardProject> {
  if (project.lead || project.isMember) {
    return project
  }
  const handle = await liveLeadOf(project.key)
  return handle ? { ...project, lead: { handle, paneKey: paneOf(handle) } } : project
}
