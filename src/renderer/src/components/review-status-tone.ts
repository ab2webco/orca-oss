import type { CheckStatus } from '../../../shared/github/pull-request-types'
import type { HostedReviewState } from '../../../shared/hosted-review'
import type { StatusTone } from './status-tone'

// Why: checks and review states read in the shared colour language on every
// surface (activity bar, card glyphs, badges), whatever the git provider.
const CHECK_TONE: Record<CheckStatus, StatusTone> = {
  pending: 'info',
  failure: 'attention',
  success: 'success',
  neutral: 'idle'
}

export function checkStatusTone(status: CheckStatus): StatusTone {
  return CHECK_TONE[status]
}

export function reviewStateTone(state: HostedReviewState): StatusTone {
  if (state === 'open') {
    return 'info'
  }
  return state === 'merged' ? 'success' : 'idle'
}
