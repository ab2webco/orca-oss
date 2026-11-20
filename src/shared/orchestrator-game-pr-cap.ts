/** What the host knows of a caller's open-PR cap; `open` and `cap` are absent when it cannot read them. */
export type GamePrCap = {
  member: boolean
  open?: number
  cap?: number
  /** Why the host could not read the cap, e.g. a member whose lead runs on another host. */
  unknown?: string
}

/** `orca game pr-cap-check` exit codes the gh wrapper reads; any other code means not checked. */
export const PR_CAP_PASS_EXIT = 0
export const PR_CAP_REFUSE_EXIT = 3

export type GamePrCapVerdict =
  | { kind: 'pass' }
  | { kind: 'refuse'; line: string }
  | { kind: 'unchecked'; line: string }

export const prCapUncheckedLineOf = (why: string): string =>
  `Orca did not check this project's open-PR cap (${why}), so gh pr create runs. The lead's game watch alerts once open PRs pass the cap.`

/** A member's `gh pr create` is refused once the project's open PRs reach its cap (ORCA-1301). */
export function gamePrCapVerdictOf(cap: GamePrCap): GamePrCapVerdict {
  if (!cap.member) {
    return { kind: 'pass' }
  }
  if (cap.open === undefined || !cap.cap) {
    return {
      kind: 'unchecked',
      line: prCapUncheckedLineOf(cap.unknown ?? 'the host could not count them')
    }
  }
  if (cap.open < cap.cap) {
    return { kind: 'pass' }
  }
  return {
    kind: 'refuse',
    line: `Orca refused gh pr create: this project has ${cap.open} open PRs and its cap is ${cap.cap}. Finish one of your open PRs first (push to it, or get it merged), or ask your lead: orca orchestration ask --question "..."`
  }
}
