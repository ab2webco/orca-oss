import {
  GAME_PROMPT_MAX,
  GAME_WORK_PROMPT_PLACEHOLDERS,
  renderGameWorkPrompt,
  unknownPlaceholderOf
} from './orchestrator-game-actions'
import { GAME_MCP_SERVER_NAME_MAX } from './orchestrator-game-member-mcp'
import { parseMemberRoster, type GameMemberName } from './orchestrator-game-member-names'

/** How the project's lead orchestrates: what it launches, how many at once, and its own rules. */
export type OrchestratorGameLead = {
  /** Make a plain session in this project the lead as soon as it starts. */
  autostart: boolean
  /** Ask the person before `game resume-members` after a restart; unset or false resumes at once. */
  askBeforeResume?: boolean
  /** Members running at once; a launch past it is refused. */
  cap: number
  /** The agent a member runs, as `orca orchestration worker-start --agent` names it. */
  agent: string
  model?: string
  /** Sent only with a model, as worker-start requires. */
  effort?: string
  /** The lead's name, shown with the crown and used by members to address it. */
  label?: string
  /** What a member is told about its ticket; placeholders {id}, {title}, {url}, {status}. */
  launchPrompt?: string
  /** What `orca game push` sends a stopped member; same placeholders as launchPrompt. */
  pushPrompt?: string
  /** The project's own standing rules, appended to Orca's. */
  rules?: string
  /** Orca's built-in lead buttons and slash commands (wave, status, push, sweep, stop); on unless false. */
  actions?: boolean
  /** A launched Claude member loads the game in its member render; on unless false. */
  memberGame?: boolean
  /** `auto` puts each member on the managed account of its agent with the most free quota. */
  accounts?: OrchestratorGameAccounts
  /** Names members take in order, in place of the scene's roster. */
  memberNames?: GameMemberName[]
  /** MCP servers every member needs; launch refuses a host and account that lack one. */
  mcpServers?: string[]
}

export type OrchestratorGameAccounts = 'default' | 'auto'

export type OrchestratorGameLeadLayer = Partial<OrchestratorGameLead>

export const GAME_LEAD_CAP_MAX = 12
const GAME_LEAD_RULES_MAX = 4000
const GAME_LEAD_LABEL_MAX = 32
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/
const MODEL_ID = /^[A-Za-z0-9._:[\]/-]{1,80}$/
const EFFORT = /^[a-z]{1,16}$/
const GAME_MCP_SERVERS_MAX = 20

export const DEFAULT_GAME_LEAD: OrchestratorGameLead = { autostart: false, cap: 4, agent: 'claude' }

/** The machine members run on: Orca's host, as `os.totalmem()` and `os.cpus()` read it. */
export type GameHostProfile = { totalMemory: number; cpuCoreCount: number }

// Why per member: an agent, its worktree's dev tools and its terminals, measured on 16 GB / 8-core Macs.
const MEMBER_MEMORY_BYTES = 4 * 1024 ** 3
const MEMBER_CPU_CORES = 2

/**
 * Members a machine runs at once when no layer sets `cap`. Total memory and cores, not what is free
 * right now, so the cap does not move while members start; low free memory has its own warning.
 */
export function defaultGameMemberCapOf(host: GameHostProfile | null): number {
  if (host === null) {
    return DEFAULT_GAME_LEAD.cap
  }
  const fit = Math.min(
    Math.floor(host.totalMemory / MEMBER_MEMORY_BYTES),
    Math.floor(host.cpuCoreCount / MEMBER_CPU_CORES)
  )
  return Math.min(GAME_LEAD_CAP_MAX, Math.max(1, Number.isFinite(fit) ? fit : 1))
}

export const DEFAULT_GAME_PUSH_PROMPT =
  'Continue {id} to the end on your own. Report to your lead when it is done or when only the person can decide.'

// Why: members' own gh CI loops spent the GitHub budget the lead needs to merge (ORCA-877).
export const GAME_MEMBER_CI_NOTE =
  "CI: read your PR's checks from Orca with `orca game state --json` (`.review.ci` is pending, success or failure); it shares one cached GitHub read with your lead. Do not poll `gh pr checks` or `gh run view`: they spend the GitHub budget the whole team shares."

export const withGameMemberCiNote = (spec: string): string => `${spec}\n\n${GAME_MEMBER_CI_NOTE}`

const at = (key: string): string => `orchestratorGame.orchestrator.${key}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown, max: number): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 && text.length <= max ? text : null
}

type KeyParser = (value: unknown) => OrchestratorGameLeadLayer | string

const idKey =
  (key: 'agent' | 'model' | 'effort', pattern: RegExp, refusal: string): KeyParser =>
  (value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    return pattern.test(text) ? { [key]: text } : `${at(key)} ${refusal}`
  }

const textKey =
  (key: 'label' | 'rules', max: number): KeyParser =>
  (value) => {
    const text = textOf(value, max)
    return text === null ? `${at(key)} must be 1 to ${max} characters` : { [key]: text }
  }

const promptKey =
  (key: 'launchPrompt' | 'pushPrompt'): KeyParser =>
  (value) => {
    const text = textOf(value, GAME_PROMPT_MAX)
    if (text === null) {
      return `${at(key)} must be 1 to ${GAME_PROMPT_MAX} characters`
    }
    const unknown = unknownPlaceholderOf(text, GAME_WORK_PROMPT_PLACEHOLDERS)
    return unknown === null
      ? { [key]: text }
      : `${at(key)} uses an unknown placeholder {${unknown}}`
  }

const switchKey =
  (key: 'autostart' | 'actions' | 'askBeforeResume' | 'memberGame'): KeyParser =>
  (value) =>
    typeof value === 'boolean' ? { [key]: value } : `${at(key)} must be true or false`

const KEY_PARSERS: Record<keyof OrchestratorGameLead, KeyParser> = {
  accounts: (value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    return text === 'default' || text === 'auto'
      ? { accounts: text }
      : `${at('accounts')} must be default or auto`
  },
  autostart: switchKey('autostart'),
  askBeforeResume: switchKey('askBeforeResume'),
  actions: switchKey('actions'),
  memberGame: switchKey('memberGame'),
  cap: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= GAME_LEAD_CAP_MAX
      ? { cap: value }
      : `${at('cap')} must be a whole number from 1 to ${GAME_LEAD_CAP_MAX}`,
  agent: idKey('agent', AGENT_ID, 'must be an agent id like claude or codex'),
  model: idKey('model', MODEL_ID, 'must be a provider model id like opus'),
  effort: idKey('effort', EFFORT, 'must be an effort level like high'),
  label: textKey('label', GAME_LEAD_LABEL_MAX),
  rules: textKey('rules', GAME_LEAD_RULES_MAX),
  launchPrompt: promptKey('launchPrompt'),
  pushPrompt: promptKey('pushPrompt'),
  mcpServers: (value) => {
    const names = Array.isArray(value)
      ? value.map((one) => textOf(one, GAME_MCP_SERVER_NAME_MAX))
      : []
    return names.length > 0 &&
      names.length <= GAME_MCP_SERVERS_MAX &&
      names.every((one) => one !== null)
      ? { mcpServers: [...new Set(names as string[])] }
      : `${at('mcpServers')} must be a list of 1 to ${GAME_MCP_SERVERS_MAX} MCP server names`
  },
  memberNames: (value) => {
    const { roster, problems } = parseMemberRoster(value)
    if (roster !== undefined) {
      return { memberNames: roster }
    }
    const first = problems[0]
    return `${at('memberNames')}${first?.path ? `.${first.path}` : ''} ${first?.message ?? 'must be a list of names'}`
  }
}

const isLeadKey = (key: string): key is keyof OrchestratorGameLead => key in KEY_PARSERS

export function parseGameLead(raw: unknown): {
  value: OrchestratorGameLeadLayer | undefined
  warnings: string[]
} {
  if (!isRecord(raw)) {
    return { value: undefined, warnings: ['orchestratorGame.orchestrator must be a mapping'] }
  }
  const value: OrchestratorGameLeadLayer = {}
  const warnings: string[] = []
  for (const [key, entry] of Object.entries(raw)) {
    const parsed = isLeadKey(key) ? KEY_PARSERS[key](entry) : `${at(key)} is not a known setting`
    if (typeof parsed === 'string') {
      warnings.push(parsed)
    } else {
      Object.assign(value, parsed)
    }
  }
  return { value, warnings }
}

// Why key by key: a project sets its cap in orca.yaml while one dev picks a model in Settings.
export function resolveGameLead(
  layers: readonly (OrchestratorGameLeadLayer | undefined)[],
  host: GameHostProfile | null = null
): OrchestratorGameLead {
  const lead: OrchestratorGameLead = { ...DEFAULT_GAME_LEAD, cap: defaultGameMemberCapOf(host) }
  for (const layer of layers) {
    const parsed = layer === undefined ? undefined : parseGameLead(layer).value
    Object.assign(lead, parsed)
  }
  if (lead.model === undefined) {
    delete lead.effort
  }
  return lead
}

/** What a new member is told about its ticket; unlike a button prompt, a missing value never drops the template. */
export function renderGameLaunchPrompt(
  template: string | undefined,
  item: { id: string; title: string; url: string; status?: string }
): string {
  if (template === undefined) {
    return renderGameWorkPrompt(undefined, item)
  }
  const values: Record<string, string | undefined> = { ...item }
  return template
    .replace(/\{([^{}]*)\}/g, (_, name: string) => values[name] ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
}
