import {
  isHttpUrl,
  matchGameActivity,
  type CompiledGameActivityRule
} from './orchestrator-game-integrations'
import type { GameActivity, GameReview, GameWorkItem } from './orchestrator-game-state'

/** The fields of a recorded MCP call that activity rules read. */
export type GameActivityCall = {
  toolName: string
  input: string
  result: string
  running: boolean
  at: number
}

const TRACKER_NAMES: Partial<Record<GameWorkItem['provider'], string>> = {
  plane: 'Plane',
  jira: 'Jira',
  linear: 'Linear'
}

// Why: hosted MCP servers prefix their tools differently (mcp__plane__, mcp__claude_ai_Atlassian__).
const TRACKER_TOOLS: Partial<Record<GameWorkItem['provider'], RegExp>> = {
  plane: /^mcp__.*plane.*__/i,
  jira: /^mcp__.*(?:atlassian|jira).*__/i,
  linear: /^mcp__.*linear.*__/i
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Why: the item URL is the one Orca built from its own tracker config, so only its key changes.
function workItemRule(item: GameWorkItem): CompiledGameActivityRule | null {
  const name = TRACKER_NAMES[item.provider]
  const tools = TRACKER_TOOLS[item.provider]
  const projectKey = /^([A-Z][A-Z0-9_]*)-\d+$/.exec(item.identifier)?.[1]
  const at = item.url.lastIndexOf(item.identifier)
  if (!name || !tools || !projectKey || at === -1 || !isHttpUrl(item.url)) {
    return null
  }
  const prefix = item.url.slice(0, at)
  if (/[{}]/.test(prefix)) {
    return null
  }
  const slash = item.url.slice(at + item.identifier.length) === '/' ? '/' : ''
  return {
    name,
    tools,
    match: new RegExp(`\\b${escapeRegExp(projectKey)}-\\d+\\b`),
    url: `${prefix}{0}${slash}`,
    id: '{0}'
  }
}

const numberKey = (keys: string): RegExp => new RegExp(`"(?:${keys})"\\s*:\\s*"?(\\d+)`)

function reviewRules(review: GameReview): CompiledGameActivityRule[] {
  if (review.provider === 'github') {
    const base = /^(https?:\/\/[^/{}]+\/[^/{}]+\/[^/{}]+)\/pull\/\d+/.exec(review.url)?.[1]
    const tools = /^mcp__.*github.*__/i
    return base
      ? [
          {
            name: 'GitHub',
            tools,
            match: numberKey('pullNumber|pull_number'),
            url: `${base}/pull/{1}`,
            id: '#{1}'
          },
          {
            name: 'GitHub',
            tools,
            match: numberKey('issue_number|issueNumber'),
            url: `${base}/issues/{1}`,
            id: '#{1}'
          }
        ]
      : []
  }
  if (review.provider === 'gitlab') {
    const base = /^(https?:\/\/[^{}]+?)\/-\/merge_requests\/\d+/.exec(review.url)?.[1]
    const tools = /^mcp__.*gitlab.*__/i
    return base
      ? [
          {
            name: 'GitLab',
            tools,
            match: numberKey('merge_request_iid|mergeRequestIid|mr_iid'),
            url: `${base}/-/merge_requests/{1}`,
            id: '!{1}'
          },
          {
            name: 'GitLab',
            tools,
            match: numberKey('issue_iid|issueIid'),
            url: `${base}/-/issues/{1}`,
            id: '#{1}'
          }
        ]
      : []
  }
  return []
}

/** Rules for Orca's own integrations, only for hosts this worktree's work item or review revealed. */
export function builtInGameActivityRules(input: {
  workItem: GameWorkItem | null
  review: GameReview | null
}): CompiledGameActivityRule[] {
  const item = input.workItem ? workItemRule(input.workItem) : null
  return [...(item ? [item] : []), ...(input.review ? reviewRules(input.review) : [])]
}

/** The newest call a rule matches, newest first; null when none does. */
export function gameActivityOf(
  calls: readonly GameActivityCall[],
  rules: readonly CompiledGameActivityRule[]
): GameActivity | null {
  if (rules.length === 0) {
    return null
  }
  for (const call of calls) {
    const found = matchGameActivity(rules, call)
    if (found) {
      return { ...found, at: call.at, running: call.running }
    }
  }
  return null
}
