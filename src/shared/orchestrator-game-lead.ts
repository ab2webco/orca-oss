import {
  GAME_PROMPT_MAX,
  GAME_WORK_PROMPT_PLACEHOLDERS,
  renderGameWorkPrompt,
  unknownPlaceholderOf
} from './orchestrator-game-actions'

/** How the project's lead orchestrates: what it launches, how many at once, and its own rules. */
export type OrchestratorGameLead = {
  /** Make a plain session in this project the lead as soon as it starts. */
  autostart: boolean
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
}

export type OrchestratorGameLeadLayer = Partial<OrchestratorGameLead>

export const GAME_LEAD_CAP_MAX = 12
const GAME_LEAD_RULES_MAX = 4000
const GAME_LEAD_LABEL_MAX = 32
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/
const MODEL_ID = /^[A-Za-z0-9._:[\]/-]{1,80}$/
const EFFORT = /^[a-z]{1,16}$/

export const DEFAULT_GAME_LEAD: OrchestratorGameLead = { autostart: false, cap: 4, agent: 'claude' }

export const DEFAULT_GAME_PUSH_PROMPT =
  'Continue {id} to the end on your own. Report to your lead when it is done or when only the person can decide.'

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
  (key: 'autostart' | 'actions'): KeyParser =>
  (value) =>
    typeof value === 'boolean' ? { [key]: value } : `${at(key)} must be true or false`

const KEY_PARSERS: Record<keyof OrchestratorGameLead, KeyParser> = {
  autostart: switchKey('autostart'),
  actions: switchKey('actions'),
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
  pushPrompt: promptKey('pushPrompt')
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
  layers: readonly (OrchestratorGameLeadLayer | undefined)[]
): OrchestratorGameLead {
  const lead: OrchestratorGameLead = { ...DEFAULT_GAME_LEAD }
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
