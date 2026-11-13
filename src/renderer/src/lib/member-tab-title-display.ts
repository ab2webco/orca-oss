const SEPARATOR = ' · '
const TICKET_ID = /^[A-Z][A-Z0-9_]*-\d+$/

/**
 * A game member's tab as shown: main stores `name · ticket · local` (workerTabTitleOf), and the
 * trailing host is relabeled here only, so stored titles and the wire keep `local` (ORCA-1149).
 */
export function memberTabTitleForDisplay(title: string, localName: string): string {
  const parts = title.split(SEPARATOR)
  if (parts.length !== 3 || !TICKET_ID.test(parts[1]) || parts[2] !== 'local') {
    return title
  }
  return [parts[0], parts[1], localName].join(SEPARATOR)
}
