// Shapes and labels for the GitHub PR review signals the mobile task list and
// action sheet render.

export type GitHubAssignableUser = {
  login: string
  name?: string | null
  avatarUrl?: string | null
}
export type GitHubPRReviewSummary = {
  login: string
  state?: string | null
  avatarUrl?: string | null
}
export type GitHubPRMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

export type GitHubPRReviewerRow = {
  login: string
  name?: string | null
  avatarUrl?: string | null
  stateLabel: string
}

export function formatGitHubReviewState(state: string | null | undefined): string {
  switch (state) {
    case 'APPROVED':
      return 'Approved'
    case 'CHANGES_REQUESTED':
      return 'Changes requested'
    case 'COMMENTED':
      return 'Commented'
    case 'DISMISSED':
      return 'Dismissed'
    case 'PENDING':
      return 'Pending'
    default:
      return 'Reviewed'
  }
}

export function getGitHubReviewerRows(item: {
  reviewRequests?: GitHubAssignableUser[]
  latestReviews?: GitHubPRReviewSummary[]
}): GitHubPRReviewerRow[] {
  const byLogin = new Map<string, GitHubPRReviewerRow>()
  for (const user of item.reviewRequests ?? []) {
    const login = user.login.trim()
    if (!login) {
      continue
    }
    byLogin.set(login.toLowerCase(), {
      login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      stateLabel: 'Requested'
    })
  }
  for (const review of item.latestReviews ?? []) {
    const login = review.login.trim()
    const key = login.toLowerCase()
    if (!login || byLogin.has(key)) {
      continue
    }
    byLogin.set(key, {
      login,
      name: null,
      avatarUrl: review.avatarUrl,
      stateLabel: formatGitHubReviewState(review.state)
    })
  }
  return Array.from(byLogin.values())
}

export function getGitHubReviewSummary(item: {
  reviewDecision?: string | null
  reviewRequests?: GitHubAssignableUser[]
  latestReviews?: GitHubPRReviewSummary[]
}): string {
  if (item.reviewDecision === 'APPROVED') {
    return 'Approved'
  }
  if (item.reviewDecision === 'CHANGES_REQUESTED') {
    return 'Changes requested'
  }
  const rows = getGitHubReviewerRows(item)
  if (rows.length === 0) {
    return 'No reviewers'
  }
  if (rows.length === 1) {
    return `${rows[0]!.login} - ${rows[0]!.stateLabel}`
  }
  return `${rows[0]!.login} +${rows.length - 1}`
}

export function formatGitHubPRDelta(item: {
  additions?: number
  deletions?: number
  changedFiles?: number
}): string | null {
  const parts: string[] = []
  if (typeof item.additions === 'number') {
    parts.push(`+${item.additions}`)
  }
  if (typeof item.deletions === 'number') {
    parts.push(`-${item.deletions}`)
  }
  if (typeof item.changedFiles === 'number') {
    parts.push(`${item.changedFiles} ${item.changedFiles === 1 ? 'file' : 'files'}`)
  }
  return parts.length > 0 ? parts.join(' ') : null
}

export function mergeGitHubAssignableUsers(
  users: GitHubAssignableUser[],
  seeds: GitHubAssignableUser[]
): GitHubAssignableUser[] {
  const byLogin = new Map<string, GitHubAssignableUser>()
  for (const user of [...users, ...seeds]) {
    const login = user.login.trim()
    if (!login || byLogin.has(login.toLowerCase())) {
      continue
    }
    byLogin.set(login.toLowerCase(), { ...user, login })
  }
  return [...byLogin.values()]
}

export function getGitHubReviewerSeedUsers(item: {
  reviewRequests?: GitHubAssignableUser[]
  latestReviews?: GitHubPRReviewSummary[]
  author?: string | null
}): GitHubAssignableUser[] {
  const byLogin = new Map<string, GitHubAssignableUser>()
  const add = (user: GitHubAssignableUser): void => {
    const login = user.login.trim()
    if (!login || byLogin.has(login.toLowerCase())) {
      return
    }
    byLogin.set(login.toLowerCase(), { ...user, login })
  }
  for (const user of item.reviewRequests ?? []) {
    add(user)
  }
  for (const review of item.latestReviews ?? []) {
    add({
      login: review.login,
      name: null,
      avatarUrl: review.avatarUrl ?? null
    })
  }
  if (item.author) {
    add({ login: item.author, name: null, avatarUrl: null })
  }
  return [...byLogin.values()]
}
