/** `orca game launch` names a member `<character> · <ticket> <title>`; the character is optional. */
export const NAMED_TICKET = /^(?:(.+?) · )?([A-Za-z][A-Za-z0-9]*-\d+)\s+(.*)$/

/** The scene character a member was named after, else its whole name. */
export const shortMemberNameOf = (name: string): string => NAMED_TICKET.exec(name)?.[1] ?? name
