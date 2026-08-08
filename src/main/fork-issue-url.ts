import { ORCA_REPOSITORY_URL } from '../shared/orca-repository-url'

// Why this exists: the fork hosts no feedback or crash service, and posting to
// upstream's sent Lab reports to maintainers who never agreed to receive them
// and cannot act on them. GitHub's own issue form is the destination we own —
// it is also the only one that can take a screenshot, since the REST API has
// no attachment upload.
const NEW_ISSUE_URL = `${ORCA_REPOSITORY_URL}/issues/new`

/** A prefilled body still has to survive a GET; browsers and GitHub cut the
 *  URL well before the issue body limit, so longer reports travel by clipboard. */
const MAX_ENCODED_BODY_LENGTH = 6000
const MAX_TITLE_LENGTH = 80

export type ForkIssueUrl = {
  url: string
  /** False when the body was too long to prefill and must be pasted instead. */
  bodyInUrl: boolean
}

export function truncateIssueTitle(title: string, fallback: string): string {
  const trimmed = title.trim()
  if (!trimmed) {
    return fallback
  }
  return trimmed.length > MAX_TITLE_LENGTH
    ? `${trimmed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : trimmed
}

export function buildForkIssueUrl(title: string, body: string): ForkIssueUrl {
  const encodedTitle = encodeURIComponent(title)
  const encodedBody = encodeURIComponent(body)
  if (encodedBody.length > MAX_ENCODED_BODY_LENGTH) {
    return { url: `${NEW_ISSUE_URL}?title=${encodedTitle}`, bodyInUrl: false }
  }
  return { url: `${NEW_ISSUE_URL}?title=${encodedTitle}&body=${encodedBody}`, bodyInUrl: true }
}
