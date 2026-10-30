import type {
  GameActivity,
  GameAgent,
  GameMemberWorktree,
  GameConfig,
  GameLink,
  GameLocale,
  GameProjectItem,
  GameProjectList,
  GameProjectWork,
  GameState,
  GameStatusGroup,
  GameWorktree
} from '../types'
import { gameActionsOf, gamePromptOf } from './game-action-shape'
import { gameLeadOf } from './game-lead'
import { rewardWeightsOf } from './rewards'
import { gameSourcesOf } from './game-sources'
import { isTerminalHandle } from './game-config'
import { lookConfigOf } from './game-render'
import { viewSwitchOf } from './game-view'
import { httpUrlOf } from './http-url'
import { isQuestMode } from './quest-policy'
import { isShape, oneOf, reviewOf, STATUS_GROUPS, str, workItemOf } from './game-state-shapes'
import { extensionsOf } from './scene-extensions'
import { memberAccountOf, memberLimitOf, memberRemoteOf } from './member-tags'
import { memberAdvisorOf, memberLaunchOf } from './member-advisor'
import { GAME_LOCALES } from './game-strings'
import { githubLowOf } from './github-budget'
import { gameMergesOf } from './member-merges'

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const LINK_KINDS = ['review', 'ci', 'workItem', 'project', 'activity'] as const
const LINK_TONES = ['neutral', 'pending', 'success', 'danger'] as const
const MAX_LINKS = 32
const MAX_LINK_TEXT = 64

const AGENT_STATES = ['working', 'waiting', 'idle', 'done'] as const

const textOf = (value: unknown): string | undefined => {
  const text = str(value)?.trim().slice(0, MAX_LINK_TEXT)
  return text === undefined || text === '' ? undefined : text
}

const activityOf = (value: unknown): GameActivity | undefined => {
  if (!isShape(value) || typeof value.at !== 'number') {
    return undefined
  }
  const name = textOf(value.name)
  const id = textOf(value.id)
  const url = httpUrlOf(value.url)
  if (name === undefined || id === undefined || url === undefined) {
    return undefined
  }
  return { name, id, url, at: value.at, running: value.running === true }
}

const linkOf = (value: unknown): GameLink[] => {
  if (!isShape(value)) {
    return []
  }
  const id = textOf(value.id)
  const kind = oneOf(value.kind, LINK_KINDS)
  const label = textOf(value.label)
  const url = httpUrlOf(value.url)
  if (id === undefined || kind === undefined || label === undefined || url === undefined) {
    return []
  }
  const status = textOf(value.status)
  const tone = oneOf(value.tone, LINK_TONES)
  return [
    {
      id,
      kind,
      provider: textOf(value.provider) ?? '',
      label,
      url,
      ...(status === undefined ? {} : { status }),
      ...(tone === undefined ? {} : { tone })
    }
  ]
}

// Why 30: Orca sends the To Do the lead waves from; the Panel draws only a few per section.
const MAX_PROJECT_ITEMS = 30

const projectItemOf = (value: unknown): GameProjectItem[] => {
  if (!isShape(value)) {
    return []
  }
  const id = textOf(value.id)
  const url = httpUrlOf(value.url)
  if (id === undefined || url === undefined) {
    return []
  }
  const status = textOf(value.status)
  const tone = oneOf(value.tone, LINK_TONES)
  const group = oneOf(value.group, STATUS_GROUPS)
  const prompt = gamePromptOf(value.prompt)
  return [
    {
      id,
      title: textOf(value.title) ?? '',
      url,
      ...(status === undefined ? {} : { status }),
      ...(tone === undefined ? {} : { tone }),
      ...(group === undefined ? {} : { group }),
      ...(prompt === undefined ? {} : { prompt })
    }
  ]
}

const groupCountsOf = (value: unknown): { groups?: Partial<Record<GameStatusGroup, number>> } => {
  if (!isShape(value)) {
    return {}
  }
  const counts = STATUS_GROUPS.flatMap((group) => {
    const count = value[group]
    return typeof count === 'number' && Number.isInteger(count) && count >= 0
      ? [[group, count] as const]
      : []
  })
  return counts.length === 0 ? {} : { groups: Object.fromEntries(counts) }
}

const ACTION_ID_MAX = 64

const actionIdOf = (value: unknown): { actionId?: string } =>
  typeof value === 'string' && value.trim() !== '' && value.trim().length <= ACTION_ID_MAX
    ? { actionId: value.trim() }
    : {}

const projectListOf = (value: unknown): GameProjectList | null => {
  if (!isShape(value) || typeof value.total !== 'number' || !Number.isFinite(value.total)) {
    return null
  }
  const items = Array.isArray(value.items) ? value.items : []
  return {
    provider: textOf(value.provider) ?? '',
    total: Math.max(0, Math.floor(value.total)),
    url: httpUrlOf(value.url) ?? null,
    items: items.flatMap(projectItemOf).slice(0, MAX_PROJECT_ITEMS),
    ...groupCountsOf(value.groups),
    ...actionIdOf(value.actionId)
  }
}

const projectWorkOf = (value: unknown): { project?: GameProjectWork } =>
  isShape(value)
    ? { project: { reviews: projectListOf(value.reviews), todo: projectListOf(value.todo) } }
    : {}

const configOf = (value: unknown): Partial<GameConfig> => {
  const raw = isShape(value) ? value : {}
  const scene = str(raw.scene)?.trim() ?? ''
  return {
    ...(isQuestMode(raw.mode) ? { mode: raw.mode } : {}),
    ...(scene === '' ? {} : { scene }),
    ...(typeof raw.hud === 'boolean' ? { hud: raw.hud } : {}),
    ...(typeof raw.rewards === 'boolean' ? { rewards: raw.rewards } : {}),
    ...(raw.openLinks === 'orca' || raw.openLinks === 'system' ? { openLinks: raw.openLinks } : {}),
    ...lookConfigOf(raw)
  }
}

const worktreeOf = (value: unknown): GameWorktree | null => {
  if (!isShape(value) || str(value.id) === undefined) {
    return null
  }
  return {
    id: str(value.id) ?? '',
    path: str(value.path) ?? '',
    branch: str(value.branch) ?? '',
    displayName: str(value.displayName) ?? ''
  }
}

const memberWorktreeOf = (value: unknown): GameMemberWorktree | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const id = str(value.id)
  const branch = str(value.branch)
  const displayName = str(value.displayName)
  return id && branch !== undefined && displayName !== undefined
    ? { id, branch, displayName }
    : undefined
}

// The host's last work seen (an ISO time) and its state start (ms), whichever is later.
// Why `activeAt` too: the band re-reads the state it stored, already parsed.
const activeAtOf = (value: Record<string, unknown>): number | undefined => {
  const { lastActivityAt, stateSince, activeAt } = value
  const times = [
    typeof lastActivityAt === 'string' ? Date.parse(lastActivityAt) : undefined,
    stateSince,
    activeAt
  ].filter((one): one is number => typeof one === 'number' && Number.isFinite(one))
  return times.length === 0 ? undefined : Math.max(...times)
}

const agentOf = (value: unknown): GameAgent[] => {
  if (!isShape(value)) {
    return []
  }
  const paneKey = str(value.paneKey)
  const state = oneOf(value.state, AGENT_STATES)
  if (paneKey === undefined || state === undefined) {
    return []
  }
  const agentType = str(value.agentType) ?? ''
  // Orca sends null for a pane with no title or task yet; it is still on the team.
  const displayName = str(value.displayName) || agentType || paneKey
  const activity = activityOf(value.activity)
  const worktree = memberWorktreeOf(value.worktree)
  const review = worktree ? reviewOf(value.review) : null
  const workItem = worktree ? workItemOf(value.workItem) : null
  const limit = memberLimitOf(value.limit)
  const account = memberAccountOf(value.account)
  const advisor = memberAdvisorOf(value.advisor)
  const launch = memberLaunchOf(value.launch)
  const remote = memberRemoteOf(value.remote)
  const activeAt = activeAtOf(value)
  return [
    {
      paneKey,
      displayName,
      agentType,
      state,
      toolName: str(value.toolName) ?? null,
      isLeader: value.isLeader === true,
      ...(isTerminalHandle(value.terminalHandle) ? { terminalHandle: value.terminalHandle } : {}),
      ...(activity === undefined ? {} : { activity }),
      ...(value.isMember === true ? { isMember: true } : {}),
      ...(worktree === undefined ? {} : { worktree }),
      ...(review === null ? {} : { review }),
      ...(workItem === null ? {} : { workItem }),
      ...(limit === undefined ? {} : { limit }),
      ...(account === undefined ? {} : { account }),
      ...(advisor === undefined ? {} : { advisor }),
      ...(launch === undefined ? {} : { launch }),
      ...(remote === undefined ? {} : { remote }),
      ...(activeAt === undefined ? {} : { activeAt })
    }
  ]
}

const localeOf = (value: unknown): { locale?: GameLocale } => {
  const locale = GAME_LOCALES.find((one) => one === value)
  return locale === undefined ? {} : { locale }
}

// Orca's CLI may answer the bare state or wrap it as { result }; anything else is no data.
export const parseGameState = (stdout: string): GameState | undefined => {
  const parsed = parseJson(stdout)
  if (!isShape(parsed)) {
    return undefined
  }
  return gameStateOf('result' in parsed ? parsed.result : parsed)
}

/** A game state from any value, such as one an older version of the mod stored. */
export const gameStateOf = (body: unknown): GameState | undefined => {
  if (!isShape(body)) {
    return undefined
  }
  const warnings = Array.isArray(body.warnings) ? body.warnings : []
  return {
    config: configOf(body.config),
    ...gameSourcesOf(body.sources),
    warnings: warnings.filter((one): one is string => typeof one === 'string'),
    worktree: worktreeOf(body.worktree),
    agents: Array.isArray(body.agents) ? body.agents.flatMap(agentOf) : [],
    review: reviewOf(body.review),
    workItem: workItemOf(body.workItem),
    extensions: extensionsOf(body.extensions),
    links: Array.isArray(body.links) ? body.links.slice(0, MAX_LINKS).flatMap(linkOf) : [],
    activity: activityOf(body.activity) ?? null,
    ...projectWorkOf(body.project),
    ...gameActionsOf(body.actions),
    ...gameLeadOf(body),
    ...rewardWeightsOf(body.rewardWeights),
    ...localeOf(body.locale),
    ...viewSwitchOf(body),
    ...githubLowOf(body),
    ...gameMergesOf(body.merges)
  }
}
