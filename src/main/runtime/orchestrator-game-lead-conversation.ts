import type { GameBoardCaller } from './orchestrator-game-board'
import type { GameLeadSession, GameLeadsDeps } from './orchestrator-game-lead-types'

// Why: an unplaced caller shares this key with every other, so one lead there is not one per project.
export const UNPLACED_PROJECT = 'no-project'

type ConversationDeps = Pick<
  GameLeadsDeps,
  'projectOf' | 'sessions' | 'reopenAccountOf' | 'panesOfConversation'
>

/** The live panes running a lead conversation now; none when Orca cannot read them. */
export async function panesOfLeadConversation(
  deps: ConversationDeps,
  session: GameLeadSession
): Promise<string[]> {
  return (await deps.panesOfConversation?.(session).catch(() => [])) ?? []
}

/** The account of the project's kept lead conversation, so a client can offer to reopen the team. */
export async function storedLeadOf(
  deps: ConversationDeps,
  caller: GameBoardCaller
): Promise<{ accountId: string | null } | null> {
  const project = await deps.projectOf(caller)
  if (project.key === UNPLACED_PROJECT) {
    return null
  }
  const session = await deps.sessions?.read(project.key).catch(() => null)
  if (!session) {
    return null
  }
  // Why the reopen's account: a removed account falls back, and the menu must name the one used.
  const reopenAccountOf = deps.reopenAccountOf
  return { accountId: reopenAccountOf ? reopenAccountOf(session) : (session.accountId ?? null) }
}

/** The panes that all run the project's lead conversation, when more than one does (ORCA-1283). */
export async function duplicateLeadOf(
  deps: ConversationDeps,
  caller: GameBoardCaller
): Promise<{ terminals: string[] } | null> {
  const project = await deps.projectOf(caller)
  if (project.isMember || project.key === UNPLACED_PROJECT) {
    return null
  }
  const stored = await deps.sessions?.read(project.key).catch(() => null)
  const terminals = stored ? await panesOfLeadConversation(deps, stored) : []
  return terminals.length > 1 ? { terminals: [...terminals].sort() } : null
}
