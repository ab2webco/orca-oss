import {
  GAME_LINK_LABEL_MAX,
  GAME_LINK_PLACEHOLDERS,
  parseGameList
} from './orchestrator-game-integrations'

/** A project button: a prompt the lead receives as a turn, or an MCP tool the mod calls itself. */
export type OrchestratorGameAction = {
  label: string
  command?: string
  key?: string
  icon?: GameActionIcon
  /** Shown in the panel's action row; unpinned ones live in its menu. */
  pin?: boolean
} & ({ prompt: string } | { mcp: GameMcpCall })

export type GameMcpCall = { server: string; tool: string; args?: Record<string, unknown> }

/** An action as `game.state` sends it: placeholders filled, keyed by its place in the list. */
export type GameAction = OrchestratorGameAction & { id: string }

export const GAME_ACTIONS_MAX = 6
export const GAME_ACTION_PINS_MAX = 3
// Why Orca's last: play, check and stop are its own buttons' icons; Settings offers the first eight.
export const GAME_ACTION_ICONS = [
  'ship',
  'flask',
  'tag',
  'review',
  'scan',
  'list',
  'pulse',
  'launch',
  'play',
  'check',
  'stop'
] as const
export type GameActionIcon = (typeof GAME_ACTION_ICONS)[number]
export const GAME_PROMPT_MAX = 2000
const GAME_MCP_ARGS_MAX = 4096
// Why: /mcp names servers with spaces and dots (`claude.ai Gmail`); tools are plain identifiers.
const MCP_SERVER = /^[A-Za-z0-9 _.-]{1,64}$/
const MCP_TOOL = /^[A-Za-z0-9_.-]{1,64}$/
const PLACEHOLDER = /\{([^{}]*)\}/g
/** Panel keys the menu (r p q), links (g t i o c w a) and tiles (1-9) own; mirrored in the mod. */
export const GAME_PANEL_RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...'rpqgtiocwa',
  ...'123456789'
])
const ACTION_KEY = /^[a-z0-9]$/
/** A slash command the mod registers for the action, as `/<command>`. */
export const GAME_ACTION_COMMAND = /^[a-z][a-z0-9-]{0,23}$/

export const GAME_WORK_PROMPT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'url',
  'status'
])
const DEFAULT_WORK_PROMPT = 'Work on {id}: {title}\n{url}'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The icon a setting names, or the warning that costs it its icon. */
export function gameActionIconOf(raw: unknown, at: string): GameActionIcon | { warning: string } {
  const icon = typeof raw === 'string' ? raw.trim() : ''
  return (GAME_ACTION_ICONS as readonly string[]).includes(icon)
    ? (icon as GameActionIcon)
    : { warning: `${at} must be one of ${GAME_ACTION_ICONS.join(', ')}` }
}

/** Null when every `{name}` is one the caller can fill, else the first one it cannot. */
export function unknownPlaceholderOf(template: string, known: ReadonlySet<string>): string | null {
  for (const [, name = ''] of template.matchAll(PLACEHOLDER)) {
    if (!known.has(name)) {
      return name
    }
  }
  return null
}

const fillTemplate = (
  template: string,
  values: Readonly<Record<string, string | undefined>>
): string | null => {
  let missing = false
  const text = template.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name]
    if (value === undefined || value === '') {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : text
}

function parseMcp(raw: unknown, at: string): GameMcpCall | string {
  if (
    !isRecord(raw) ||
    typeof raw.server !== 'string' ||
    typeof raw.tool !== 'string' ||
    !MCP_SERVER.test(raw.server.trim()) ||
    !MCP_TOOL.test(raw.tool.trim())
  ) {
    return `${at}.mcp must name a server and a tool like list_test_runs`
  }
  const call: GameMcpCall = { server: raw.server.trim(), tool: raw.tool.trim() }
  if (raw.args === undefined) {
    return call
  }
  if (!isRecord(raw.args) || JSON.stringify(raw.args).length > GAME_MCP_ARGS_MAX) {
    return `${at}.mcp.args must be a mapping`
  }
  return { ...call, args: raw.args }
}

function parseAction(entry: unknown, at: string): OrchestratorGameAction | string {
  if (!isRecord(entry) || (entry.prompt === undefined) === (entry.mcp === undefined)) {
    return `${at} must have either prompt or mcp`
  }
  const label = typeof entry.label === 'string' ? entry.label.trim() : ''
  if (label.length === 0 || label.length > GAME_LINK_LABEL_MAX) {
    return `${at}.label must be 1 to ${GAME_LINK_LABEL_MAX} characters`
  }
  const command = typeof entry.command === 'string' ? entry.command.trim() : entry.command
  if (
    command !== undefined &&
    (typeof command !== 'string' || !GAME_ACTION_COMMAND.test(command))
  ) {
    return `${at}.command must be a lowercase name like test-runs, up to 24 characters`
  }
  const head = command === undefined ? { label } : { label, command }
  if (entry.mcp !== undefined) {
    const mcp = parseMcp(entry.mcp, at)
    return typeof mcp === 'string' ? mcp : { ...head, mcp }
  }
  const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : ''
  if (prompt.length === 0 || prompt.length > GAME_PROMPT_MAX) {
    return `${at}.prompt must be 1 to ${GAME_PROMPT_MAX} characters`
  }
  const unknown = unknownPlaceholderOf(prompt, GAME_LINK_PLACEHOLDERS)
  return unknown === null
    ? { ...head, prompt }
    : `${at}.prompt uses an unknown placeholder {${unknown}}`
}

// Why up front: a duplicate is only seen across the list, and a bad key costs the key, not the button.
function actionKeysOf(raw: unknown): { keys: (string | undefined)[]; warnings: string[] } {
  const keys: (string | undefined)[] = []
  const warnings: string[] = []
  const taken = new Set<string>()
  const list = Array.isArray(raw) ? raw.slice(0, GAME_ACTIONS_MAX) : []
  list.forEach((entry: unknown, index) => {
    const said = isRecord(entry) ? entry.key : undefined
    if (said === undefined) {
      keys.push(undefined)
      return
    }
    const at = `orchestratorGame.actions[${index}].key`
    const key = typeof said === 'string' ? said.trim() : ''
    const refusal = !ACTION_KEY.test(key)
      ? `${at} must be one lowercase letter or digit`
      : GAME_PANEL_RESERVED_KEYS.has(key)
        ? `${at} ${key} is taken by the Panel`
        : taken.has(key)
          ? `${at} ${key} is already another action's`
          : null
    if (refusal !== null) {
      warnings.push(refusal)
    } else {
      taken.add(key)
    }
    keys.push(refusal === null ? key : undefined)
  })
  return { keys, warnings }
}

// Why apart: a bad icon or pin costs the action that field, never its button.
function withLook(
  action: OrchestratorGameAction,
  entry: Record<string, unknown>,
  at: string,
  pinned: { count: number },
  warnings: string[]
): OrchestratorGameAction {
  const look: Pick<OrchestratorGameAction, 'icon' | 'pin'> = {}
  if (entry.icon !== undefined) {
    const icon = gameActionIconOf(entry.icon, `${at}.icon`)
    if (typeof icon === 'string') {
      look.icon = icon
    } else {
      warnings.push(icon.warning)
    }
  }
  if (entry.pin !== undefined && typeof entry.pin !== 'boolean') {
    warnings.push(`${at}.pin must be true or false`)
  } else if (entry.pin === true && pinned.count >= GAME_ACTION_PINS_MAX) {
    warnings.push(`${at}.pin: the panel row holds ${GAME_ACTION_PINS_MAX} pinned actions`)
  } else if (entry.pin !== undefined) {
    pinned.count += entry.pin ? 1 : 0
    look.pin = entry.pin
  }
  return { ...action, ...look }
}

export function parseGameActions(raw: unknown): {
  value: OrchestratorGameAction[] | undefined
  warnings: string[]
} {
  const { keys, warnings } = actionKeysOf(raw)
  const looks: string[] = []
  const pinned = { count: 0 }
  const parsed = parseGameList(raw, 'actions', GAME_ACTIONS_MAX, (entry, at, index) => {
    const action = parseAction(entry, at)
    if (typeof action === 'string' || !isRecord(entry)) {
      return action
    }
    const key = keys[index]
    const looked = withLook(action, entry, at, pinned, looks)
    return key === undefined ? looked : { ...looked, key }
  })
  return { value: parsed.value, warnings: [...parsed.warnings, ...looks, ...warnings] }
}

/** The project's actions for this worktree; a prompt whose placeholder has no value is left out. */
export function gameActionsOf(
  actions: readonly OrchestratorGameAction[],
  values: Readonly<Record<string, string | undefined>>
): GameAction[] {
  return actions.flatMap((action, index): GameAction[] => {
    const id = `action-${index}`
    if (!('prompt' in action)) {
      return [{ ...action, id }]
    }
    const prompt = fillTemplate(action.prompt, values)
    return prompt === null ? [] : [{ ...action, id, prompt }]
  })
}

/** What "work on" sends the lead for one To Do ticket. */
export function renderGameWorkPrompt(
  template: string | undefined,
  item: { id: string; title: string; url: string; status?: string }
): string {
  const values = { id: item.id, title: item.title, url: item.url, status: item.status }
  return (
    fillTemplate(template ?? DEFAULT_WORK_PROMPT, values) ??
    fillTemplate(DEFAULT_WORK_PROMPT, values) ??
    `Work on ${item.id}`
  )
}
