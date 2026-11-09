import { GitMerge, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusToneTextClass } from '@/components/status-tone'
import { checkStatusTone, reviewStateTone } from '@/components/review-status-tone'
import { PullRequestIcon } from './WorktreeCardHelpers'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'

export function getReviewLabel(review: WorktreeCardPrDisplay): 'MR' | 'PR' {
  return review.provider === 'gitlab' ? 'MR' : 'PR'
}

export function getProviderName(review: WorktreeCardPrDisplay): string {
  if (review.provider === 'gitlab') {
    return 'GitLab'
  }
  if (review.provider === 'bitbucket') {
    return 'Bitbucket'
  }
  if (review.provider === 'azure-devops') {
    return 'Azure DevOps'
  }
  if (review.provider === 'gitea') {
    return 'Gitea'
  }
  return 'GitHub'
}

// Why: the glyph must carry review state — tone alone made a draft with failing
// checks render as a red PR icon, which reads as closed.
function getStateIcon(
  state: WorktreeCardPrDisplay['state']
): React.ComponentType<{ className?: string }> | null {
  if (state === 'merged') {
    return GitMerge
  }
  if (state === 'closed') {
    return GitPullRequestClosed
  }
  if (state === 'draft') {
    return GitPullRequestDraft
  }
  return null
}

// Why: checks only gate a review that is actually open; draft/closed/merged keep
// their state tone so the glyph agrees with its tooltip. A stateless row (folder
// cards render one while a linked review is loading or its details failed) has no
// state glyph to contradict, so it still flags problems — but never claims success,
// since green would assert an open review we have not confirmed.
function getCheckTone(review: WorktreeCardPrDisplay): string | null {
  if (review.state && review.state !== 'open') {
    return null
  }
  if (review.status === 'failure' || review.status === 'pending') {
    return statusToneTextClass(checkStatusTone(review.status))
  }
  if (review.state === 'open' && review.status === 'success') {
    return statusToneTextClass('success')
  }
  return null
}

function getStateTone(state: WorktreeCardPrDisplay['state']): string {
  if (state === 'merged' || state === 'open') {
    return statusToneTextClass(reviewStateTone(state))
  }
  if (state === 'closed') {
    return 'text-muted-foreground/60'
  }
  if (state === 'draft') {
    return 'text-muted-foreground/50'
  }
  return 'text-muted-foreground opacity-70'
}

export function ReviewIcon({
  review,
  className,
  variant = 'provider'
}: {
  review: WorktreeCardPrDisplay
  className?: string
  variant?: 'provider' | 'generic'
}): React.JSX.Element {
  const providerIcon =
    variant === 'provider' && review.provider === 'gitlab' ? GitMerge : PullRequestIcon
  const Icon = getStateIcon(review.state) ?? providerIcon
  return <Icon className={cn(className, getCheckTone(review) ?? getStateTone(review.state))} />
}
