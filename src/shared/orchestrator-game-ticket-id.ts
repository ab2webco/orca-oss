/** Ticket ids like CIN-12, as Orca reads them out of a member's name, title or branch. */

const TICKET = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9_]*-\d+)(?![A-Z0-9])/

/** The first ticket id like CIN-12 a title, name or branch carries. */
export function ticketInText(text: string | null | undefined): string | null {
  return text?.toUpperCase().match(TICKET)?.[1] ?? null
}
