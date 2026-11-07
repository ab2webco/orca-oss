/**
 * Whether the card title opens the details hover. Why a live agent counts: model, account and cache
 * left the row, and a default card with no badge would otherwise have no way to reach them.
 */
export function worktreeCardTitleHoverShown(args: {
  compactCards: boolean
  activityViewOpen: boolean
  showBranchIdentityHover: boolean
  hasDetails: boolean
  hasPorts: boolean
  hasLiveAgent: boolean
}): boolean {
  const { compactCards, hasDetails, hasPorts, hasLiveAgent } = args
  if (args.activityViewOpen) {
    return false
  }
  return compactCards
    ? args.showBranchIdentityHover || hasDetails || hasPorts || hasLiveAgent
    : hasLiveAgent && !hasDetails && !hasPorts
}
