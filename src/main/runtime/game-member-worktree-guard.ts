import type {
  GameMemberSession,
  GameMemberSessionsRead
} from '../../shared/orchestrator-game-member-sessions'

export const GAME_MEMBER_WORKTREE_ERROR_CODE = 'game_member_worktree'

/** A saved game member that still holds a worktree, and what removing it would lose (ORCA-746). */
export type GameMemberWorktreeHold = {
  ticket: string
  name: string | null
  lastState: string | null
  /** `<sha> <subject>` per commit no remote has; null when git could not tell. */
  unpushed: string[] | null
}

export class GameMemberWorktreeError extends Error {
  readonly code = GAME_MEMBER_WORKTREE_ERROR_CODE

  constructor(
    message: string,
    readonly data: { ticket: string; unpushed: string[] | null }
  ) {
    super(message)
  }
}

export async function readGameMemberWorktreeHold(deps: {
  read: () => Promise<GameMemberSessionsRead>
  worktreeId: string
  listUnpushed: () => Promise<string[]>
}): Promise<GameMemberWorktreeHold | null> {
  const read = await deps.read()
  // Why let an unreadable record through: `game fleet` already reports it, and it names no worktree.
  const member: GameMemberSession | undefined = read.ok
    ? read.members.find((one) => one.worktreeId === deps.worktreeId && one.lastState !== 'finished')
    : undefined
  if (!member) {
    return null
  }
  const unpushed = await deps.listUnpushed().catch(() => null)
  return { ticket: member.ticket, name: member.name, lastState: member.lastState, unpushed }
}

export const parseUnpushedCommits = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const memberOf = (hold: GameMemberWorktreeHold): string =>
  `game member ${hold.ticket} (${[hold.name, hold.lastState ? `last ${hold.lastState}` : null].filter(Boolean).join(', ')})`

const unpushedOf = (hold: GameMemberWorktreeHold): string => {
  if (hold.unpushed === null) {
    return 'Unpushed commits: unknown (git could not read them).'
  }
  return hold.unpushed.length === 0
    ? 'Unpushed commits: none.'
    : `Unpushed commits (${hold.unpushed.length}): ${hold.unpushed.join('; ')}.`
}

export const memberWorktreeRefusal = (hold: GameMemberWorktreeHold): GameMemberWorktreeError =>
  new GameMemberWorktreeError(
    `This is the worktree of ${memberOf(hold)}; removing it loses its work. ${unpushedOf(hold)} ` +
      `\`orca game resume-members ${hold.ticket}\` resumes it, \`orca game resume-members ${hold.ticket} --discard\` frees it, ` +
      'or pass --force-member to remove it anyway.',
    { ticket: hold.ticket, unpushed: hold.unpushed }
  )

export const memberWorktreeWarning = (hold: GameMemberWorktreeHold): string =>
  `Removed the worktree of ${memberOf(hold)}. ${unpushedOf(hold)}`
