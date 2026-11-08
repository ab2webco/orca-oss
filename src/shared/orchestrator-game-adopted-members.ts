import {
  pausedMembersOf,
  unlistedMembersOf,
  type GameMemberSession,
  type GamePausedCauseOf,
  type GamePausedMember,
  type GameUnlistedMember
} from './orchestrator-game-member-sessions'

/** A paused member `game adopt` took carries its pane, so adopting that agent again resumes it. */
export type GameStatePausedMember = GamePausedMember & { adoptedPane?: string }

/** The saved-member key for an adopted agent's name, which may hold spaces (`main 2`). */
export function adoptedMemberKeyOf(name: string): string | null {
  const key = name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 40)
  return key || null
}

/**
 * Paused and unlisted members, with an adopted one judged by its own pane: it shares its worktree
 * with other agents, so a live worktree says nothing about it (ORCA-1141).
 */
export function pausedAndUnlistedMembersOf(args: {
  members: readonly GameMemberSession[]
  live: { tickets: ReadonlySet<string>; worktreeIds: ReadonlySet<string> }
  livePaneKeys: ReadonlySet<string>
  starting: ReadonlySet<string>
  causeOf: GamePausedCauseOf
  gone: ReadonlySet<string>
}): { paused: GameStatePausedMember[]; unlisted: GameUnlistedMember[] } {
  const paneOf = new Map(
    args.members.flatMap((one) => (one.adoptedPaneKey ? [[one.ticket, one.adoptedPaneKey]] : []))
  )
  const launched = args.members.filter((one) => !paneOf.has(one.ticket))
  const adopted = args.members.filter((one) => paneOf.has(one.ticket))
  const liveAdopted = {
    tickets: new Set(
      adopted
        .filter((one) => args.livePaneKeys.has(paneOf.get(one.ticket)!))
        .map((one) => one.ticket)
    ),
    worktreeIds: new Set<string>()
  }
  return {
    paused: [
      ...pausedMembersOf(launched, args.live, args.starting, args.causeOf, args.gone),
      // Why no cause: resume-members skips an open terminal and --discard stops it, and this tab is the user's.
      ...pausedMembersOf(adopted, liveAdopted, args.starting, () => null, args.gone).map((one) => ({
        ...one,
        adoptedPane: paneOf.get(one.ticket)
      }))
    ],
    unlisted: unlistedMembersOf(launched, args.live, args.starting)
  }
}
