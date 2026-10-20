import {
  getGeneratedWorktreeCreateRetryCandidate,
  isGeneratedWorktreeCreateName,
  WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS
} from '../shared/new-workspace/worktree-create-retry-policy'

export { isGeneratedWorktreeCreateName, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS }

export function getWorktreeCreateCandidate(value: string, suffix: number): string {
  return suffix === 1 ? value : `${value}-${suffix}`
}

export function getGeneratedWorktreeCreateCandidate(
  value: string,
  suffix: number,
  exhaustedTiers = 0
): string {
  return getGeneratedWorktreeCreateRetryCandidate(value, suffix - 1, exhaustedTiers + 1)
}

export function getBranchNameOverrideCandidate(
  branchNameOverride: string | undefined,
  suffix: number
): string | undefined {
  return branchNameOverride ? getWorktreeCreateCandidate(branchNameOverride, suffix) : undefined
}
