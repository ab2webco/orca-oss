/** `orca game launch` names a member `<character> · <ticket> <title>`; character and title are optional. */
export const NAMED_TICKET = /^(?:(.+?) · )?([A-Za-z][A-Za-z0-9_]*-\d+)(?:\s+(.*))?$/

/** The scene character a member was named after, else its whole name. */
export const shortMemberNameOf = (name: string): string => NAMED_TICKET.exec(name)?.[1] ?? name

// Why the worktree: a member's own row is not in its pane's state, and it carries the launched name.
/** Whose figure a pane's hero is: a member's own name, else the lead's title. */
export const heroNameOf = (
  isMember: boolean,
  worktreeName: string | undefined,
  lead: string | undefined
): string | undefined =>
  isMember && worktreeName !== undefined && NAMED_TICKET.test(worktreeName) ? worktreeName : lead
