export type PullRequestHeadIdentity = {
  headRefName?: string
  headRepositoryOwner?: { login?: string } | null
}

export type PullRequestHeadExpectation = {
  branchName: string
  /** Owner of the repo the worktree pushes to (origin); null when unknown. */
  headOwner: string | null
}

/** 2 = branch and owner match, 1 = branch matches but another owner pushed it, 0 = other head. */
export type PullRequestHeadMatchRank = 0 | 1 | 2

export const FULL_PULL_REQUEST_HEAD_MATCH: PullRequestHeadMatchRank = 2

// Why (ORCA-585): a fork that hosts its own PRs shares PR numbers with upstream,
// so a PR number alone does not identify which candidate repo owns the review.
export function rankPullRequestHeadMatch(
  pr: PullRequestHeadIdentity,
  expected: PullRequestHeadExpectation
): PullRequestHeadMatchRank {
  if (!pr.headRefName || pr.headRefName !== expected.branchName) {
    return 0
  }
  const prOwner = pr.headRepositoryOwner?.login?.trim().toLowerCase()
  const expectedOwner = expected.headOwner?.trim().toLowerCase()
  // Why: GitHub logins are case-insensitive; an unknown owner cannot disprove the match.
  if (!prOwner || !expectedOwner || prOwner === expectedOwner) {
    return 2
  }
  return 1
}
