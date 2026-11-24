import { ticketInText } from '../../../../shared/orchestrator-game-ticket-id'
import { isAskUserQuestionTool } from '../../../../shared/agent-question-answered-intent'
import { toolDisplayWords } from '../../../../shared/tool-display-words'
import {
  teamModelCreditTextOf,
  teamModelLabelText
} from '../../../../shared/team-panel-agent-model'
import { TEAM_ADVISOR_NAME } from '../../../../shared/team-model-advisor-words'
import type { GameTicketKind } from '../../../../shared/orchestrator-game-ticket-kind'
import { translate } from '@/i18n/i18n'
import { teamStewardCreditText } from './team-steward-text'
import type { StatusTone } from '@/components/status-tone'
import type { StatusDotGlyph } from '@/components/StatusDot'
import type {
  TeamCondition,
  TeamFlowPhase,
  TeamHost,
  TeamLiveAction,
  TeamMemberAsk,
  TeamMemberCard,
  TeamModel,
  TeamPullRequest,
  TeamStatus,
  TeamTicket
} from '../../../../shared/team-panel-model-types'
import { localHostDisplayLabel } from '../../lib/local-host-display-label'
import { teamIdleCiOf } from '../../../../shared/team-member-shown-state'
import { formatShortActivityAge } from '../sidebar/short-activity-age'

const TONE: Record<TeamStatus, StatusTone> = {
  attention: 'attention',
  risk: 'warning',
  working: 'info',
  done: 'success',
  idle: 'idle',
  failed: 'attention',
  closed: 'idle'
}

export function teamStatusTone(status: TeamStatus): StatusTone {
  return TONE[status]
}

const GLYPH: Partial<Record<TeamStatus, StatusDotGlyph>> = {
  attention: 'question',
  failed: 'alert',
  working: 'spinner',
  closed: 'closed'
}

/** V28's marks: a question only for needs-you, a spinner while working, else a dot. */
export function teamStatusGlyph(status: TeamStatus): StatusDotGlyph {
  return GLYPH[status] ?? 'dot'
}

/** V28's short age: `now`, `10 min`, `13 h`, `3 d`; the sidebar's one formatter. */
export function teamAgeText(since: number, now: number): string {
  return formatShortActivityAge(since, now) ?? ''
}

/** Says the row age is time in the current state: QA read the bare age as time worked. */
export function teamAgeLabel(since: number, now: number): string | undefined {
  const age = teamAgeText(since, now)
  if (!age) {
    return undefined
  }
  if (now - since < 60_000) {
    return translate('teamPanel.card.ageInStateNow', 'In this state for less than a minute')
  }
  return translate('teamPanel.card.ageInState', 'In this state for {{age}}', { age })
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

/** The lead's line: what it does now, led by V30's verb while it works on something. */
export function teamLeadLiveText(
  action: TeamLiveAction | null,
  condition: TeamCondition,
  waitingOn = 0
): string {
  // Why (ORCA-1205): a lead whose turn ended still coordinates while members work.
  if (!action && waitingOn > 0 && (condition === 'idle' || condition === 'done')) {
    return waitingOn === 1
      ? translate('teamPanel.lead.waitingOnOne', 'Waiting on 1 agent')
      : translate('teamPanel.lead.waitingOnMany', 'Waiting on {{count}} agents', {
          count: waitingOn
        })
  }
  const text = teamLiveText(action, condition)
  return condition === 'working' && action !== null && action.kind !== 'question'
    ? translate('teamPanel.lead.orchestrating', 'Orchestrating · {{action}}', { action: text })
    : text
}

/** What a tool works on, named as every tool label is: `Bash · gh pr checks 924`; alone, as words. */
export const teamToolText = (tool: string, detail: string | null): string =>
  detail ? `${tool} · ${detail}` : toolDisplayWords(tool)

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

/** What a member waits on the person for; an older client's card without `ask` meant the Inbox. */
export function teamAskText(ask: TeamMemberAsk | null | undefined): string {
  switch (ask?.kind) {
    case 'permission':
      return ask.tool
        ? translate('teamPanel.card.permissionPrompt', 'Permission prompt: {{tool}}', {
            tool: ask.tool
          })
        : translate('teamPanel.card.permissionPromptAny', 'Permission prompt in its terminal')
    case 'inbox':
    case undefined:
      return translate('teamPanel.card.waitingForAnswer', 'Waiting for your answer')
  }
}

/** A member's line: what it does now, or the CI a stopped member's open PR waits on (ORCA-1205). */
export function teamMemberLiveText(
  card: Pick<TeamMemberCard, 'condition' | 'liveAction' | 'pr'>
): string {
  switch (teamIdleCiOf(card)) {
    case 'failure':
      return translate('teamPanel.card.ciFailed', 'CI failing')
    case 'pending':
      return translate('teamPanel.card.ciRunning', 'CI running')
    case null:
      return teamLiveText(card.liveAction, card.condition)
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
  return model ? teamModelLabelText(model) : null
}

/** Who picked the model and why; null where no router or chooser is known. */
export function teamModelCreditText(model: TeamModel | null): string | null {
  const advisor = TEAM_ADVISOR_NAME
  return teamModelCreditTextOf(model?.credit, {
    steward: teamStewardCreditText,
    chosenByAdvisor: translate('teamPanel.model.chosenByAdvisor', 'Chosen by {{advisor}}', {
      advisor
    }),
    advisorReason: (reason) =>
      translate('teamPanel.model.advisorReason', '{{reason}} ({{advisor}})', { reason, advisor }),
    chosenByLead: (kind, source) => {
      const words = { kind: teamTicketKindText(kind) }
      switch (source) {
        case 'flag':
          return translate('teamPanel.model.chosenByLead', 'Chosen by the lead: {{kind}}', words)
        case 'ticket':
          return translate(
            'teamPanel.model.inferredFromTicket',
            'Inferred from the ticket: {{kind}}',
            words
          )
        case 'default':
          return translate('teamPanel.model.leadDefault', 'Lead default: {{kind}}', words)
      }
    }
  })
}

export function teamTicketKindText(kind: GameTicketKind): string {
  switch (kind) {
    case 'audit':
      return translate('teamPanel.model.kind.audit', 'read-only audit')
    case 'implement':
      return translate('teamPanel.model.kind.implement', 'implementation')
    case 'review':
      return translate('teamPanel.model.kind.review', 'review or design')
    case 'captures':
      return translate('teamPanel.model.kind.captures', 'captures')
  }
}

/** `localName` is the user's rename of this machine, which wins over the default label. */
export function teamHostText(host: TeamHost, localName?: string | null): string {
  return host.kind === 'local' ? localName?.trim() || localHostDisplayLabel() : host.name
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
  // Why the name's own ticket: 'Merlin · E2E-801' already says it, as the sidebar row does (#1125).
  return identifier && !(showName && ticketInText(card.name) === identifier.toUpperCase())
    ? identifier
    : null
}

/** A usage meter's fill by percent used, in the status tokens, with its track a lighter step of it. */
export function teamUsageBarClass(usedPercent: number): { fill: string; track: string } {
  if (usedPercent < 60) {
    return { fill: 'bg-status-idle', track: 'bg-status-idle/20' }
  }
  return usedPercent < 90
    ? { fill: 'bg-status-warning', track: 'bg-status-warning/20' }
    : { fill: 'bg-status-attention/70', track: 'bg-status-attention/15' }
}

/** A branch split for a middle cut: `tail` holds the ticket part (or last segment) and stays whole longest. */
export function teamBranchParts(branch: string): { head: string; tail: string } {
  const ticket = ticketInText(branch)
  const at = ticket ? branch.toUpperCase().lastIndexOf(ticket) : -1
  const cut = at >= 0 ? at : branch.lastIndexOf('/') + 1
  return { head: branch.slice(0, cut), tail: branch.slice(cut) }
}

export function teamHelpersCountText(count: number): string {
  return count === 1
    ? translate('teamPanel.card.helpers_one', '{{count}} helper', { count })
    : translate('teamPanel.card.helpers_other', '{{count}} helpers', { count })
}

export function teamHelperStateText(state: 'working' | 'done'): string {
  return state === 'working'
    ? translate('teamPanel.card.helper.working', 'Working')
    : translate('teamPanel.card.helper.done', 'Done')
}
