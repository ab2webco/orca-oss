import { isAskUserQuestionTool } from '../../../../shared/agent-question-answered-intent'
import { translate } from '@/i18n/i18n'
import type { StatusTone } from '@/components/status-tone'
import type { StatusDotGlyph } from '@/components/StatusDot'
import type {
  TeamCondition,
  TeamFlowPhase,
  TeamHost,
  TeamLiveAction,
  TeamModel,
  TeamPullRequest,
  TeamStatus,
  TeamTicket
} from '../../../../shared/team-panel-model-types'

const TONE: Record<TeamStatus, StatusTone> = {
  attention: 'attention',
  risk: 'warning',
  working: 'info',
  done: 'success',
  idle: 'idle'
}

export function teamStatusTone(status: TeamStatus): StatusTone {
  return TONE[status]
}

/** V28's marks: a question for needs-you or failed, a spinner while working, else a dot. */
export function teamStatusGlyph(status: TeamStatus): StatusDotGlyph {
  return status === 'attention' ? 'question' : status === 'working' ? 'spinner' : 'dot'
}

const MINUTE = 60_000

/** V28's short age: `now`, `10 min`, `13 h`, `3 d`. */
export function teamAgeText(since: number, now: number): string {
  const minutes = Math.floor((now - since) / MINUTE)
  if (minutes < 1) {
    return translate('teamPanel.age.now', 'now')
  }
  if (minutes < 60) {
    return translate('teamPanel.age.minutes', '{{count}} min', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24
    ? translate('teamPanel.age.hours', '{{count}} h', { count: hours })
    : translate('teamPanel.age.days', '{{count}} d', { count: Math.floor(hours / 24) })
}

export function teamConditionText(condition: TeamCondition): string {
  switch (condition) {
    case 'working':
      return translate('teamPanel.condition.working', 'Working')
    case 'waiting':
      return translate('teamPanel.condition.waiting', 'Waiting for you')
    case 'idle':
      return translate('teamPanel.condition.idle', 'Idle')
    case 'done':
      return translate('teamPanel.condition.done', 'Done')
    case 'starting':
      return translate('teamPanel.condition.starting', 'Starting')
    case 'queued':
      return translate('teamPanel.condition.queued', 'Queued')
    case 'paused':
      return translate('teamPanel.condition.paused', 'Paused')
    case 'asleep':
      return translate('teamPanel.condition.asleep', 'Asleep')
    case 'limited':
      return translate('teamPanel.condition.limited', 'Usage limit reached')
    case 'loggedOut':
      return translate('teamPanel.condition.loggedOut', 'Logged out')
    case 'unreachable':
      return translate('teamPanel.condition.unreachable', 'Host unreachable')
    case 'gone':
      return translate('teamPanel.condition.gone', 'Session closed')
    case 'startFailed':
      return translate('teamPanel.condition.startFailed', 'Failed to start')
  }
}

/** A session's state as the no-team view words it; only waiting differs from a member's. */
export function teamSessionStateText(condition: TeamCondition): string {
  return condition === 'waiting'
    ? translate('teamPanel.activity.needsYou', 'Needs you')
    : teamConditionText(condition)
}

/** What a tool works on, named as every tool label is: `Bash · gh pr checks 924`. */
export const teamToolText = (tool: string, detail: string | null): string =>
  detail ? `${tool} · ${detail}` : tool

/** What the agent does now; agent words (tool detail, questions) are shown as written. */
export function teamLiveText(action: TeamLiveAction | null, condition: TeamCondition): string {
  if (!action) {
    return teamConditionText(condition)
  }
  switch (action.kind) {
    case 'tool':
      // Why: game.state names the question tool, never its question, and a name is no status.
      return isAskUserQuestionTool(action.tool)
        ? teamConditionText('waiting')
        : teamToolText(action.tool, action.detail)
    case 'link':
      return `${action.name} · ${action.id}`
    case 'question':
      return action.text
  }
}

/** GitLab numbers a merge request !12; every other provider says #12. */
export function teamPrNumberText(pr: Pick<TeamPullRequest, 'provider' | 'number'>): string {
  return pr.provider === 'gitlab' ? `!${pr.number}` : `#${pr.number}`
}

export function teamPhaseText(phase: TeamFlowPhase): string {
  switch (phase) {
    case 'plan':
      return translate('teamPanel.phase.plan', 'Planning')
    case 'docs':
      return translate('teamPanel.phase.docs', 'Documenting')
    case 'code':
      return translate('teamPanel.phase.code', 'Coding')
    case 'tests':
      return translate('teamPanel.phase.tests', 'Testing')
    case 'pr':
      return translate('teamPanel.phase.pr', 'In PR')
    case 'merge':
      return translate('teamPanel.phase.merge', 'Merging')
  }
}

export function teamModelText(model: TeamModel | null): string | null {
  if (!model) {
    return null
  }
  return model.effort ? `${model.label} · ${model.effort}` : model.label
}

export function teamHostText(host: TeamHost): string {
  return host.kind === 'local' ? translate('teamPanel.host.local', 'local') : host.name
}

/** The PR chip's second half; null when there is nothing to say about its checks. */
export function teamCiText(pr: TeamPullRequest): string | null {
  if (pr.state === 'merged') {
    return translate('teamPanel.card.merged', 'Merged')
  }
  switch (pr.ci) {
    case 'failure':
      return translate('teamPanel.card.ciFailed', 'CI failing')
    case 'pending':
      return translate('teamPanel.card.ciRunning', 'CI running')
    case 'success':
      return translate('teamPanel.card.ciPassed', 'CI green')
    case 'neutral':
    case 'none':
      return null
  }
}

/** The PR chip's dot, as V28 draws it; null when its checks say nothing. */
export function statusToneOfCi(pr: Pick<TeamPullRequest, 'state' | 'ci'>): StatusTone | null {
  if (pr.state === 'merged') {
    return 'success'
  }
  switch (pr.ci) {
    case 'failure':
      return 'attention'
    case 'pending':
      return 'info'
    case 'success':
      return 'success'
    case 'neutral':
    case 'none':
      return null
  }
}

/** The ticket printed beside the name; null when the member is named after it, so it shows once. */
export function teamTicketBesideName(
  card: { name: string; ticket: TeamTicket | null },
  showName: boolean
): string | null {
  const identifier = card.ticket?.identifier ?? null
  return identifier && !(showName && card.name === identifier) ? identifier : null
}
