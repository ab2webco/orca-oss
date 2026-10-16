export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** A static project link; `url` may name the placeholders in GAME_LINK_PLACEHOLDERS. */
export type OrchestratorGameLinkTemplate = { label: string; url: string }

/** Turns an id an agent's MCP call mentions into a link; `url` uses {0} (match) and {1..9} (groups). */
export type OrchestratorGameActivityRule = {
  name: string
  /** Tool name glob, e.g. `mcp__tambora__*`; every MCP tool when absent. */
  tools?: string
  match: string
  url: string
}

export type CompiledGameActivityRule = {
  name: string
  tools: RegExp | null
  match: RegExp
  url: string
  /** Shown id; `{0}` for project rules, a short form such as `#{1}` for built-in ones. */
  id: string
}

export type GameActivityMatch = { name: string; id: string; url: string }

export const GAME_LINK_LABEL_MAX = 24
export const GAME_LINKS_MAX = 6
export const GAME_ACTIVITY_RULES_MAX = 8
export const GAME_ACTIVITY_PATTERN_MAX = 200
// Why: bounds what a project regex scans per call, the only cost a pathological pattern can grow.
export const GAME_ACTIVITY_TEXT_MAX = 4096
const GAME_URL_TEMPLATE_MAX = 1024

export const GAME_LINK_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'workItem.identifier',
  'workItem.provider',
  'branch',
  'review.number'
])

const PLACEHOLDER = /\{([^{}]*)\}/g
// Why: no placeholder, brace or userinfo before the path, so a value can never change where a link points.
const LITERAL_ORIGIN = /^https?:\/\/[^/?#{}@\s]+(?:[/?#]|$)/i
const TOOL_GLOB = /^[A-Za-z0-9_.*-]{1,100}$/

type Parsed<T> = { value: T[] | undefined; warnings: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const shortText = (value: unknown, max: number): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

function templateProblem(
  template: string,
  isPlaceholder: (name: string) => boolean
): string | null {
  if (template.length > GAME_URL_TEMPLATE_MAX || !LITERAL_ORIGIN.test(template)) {
    return 'must be an http(s) URL with a literal host'
  }
  for (const [, name = ''] of template.matchAll(PLACEHOLDER)) {
    if (!isPlaceholder(name)) {
      return `uses an unknown placeholder {${name}}`
    }
  }
  const bare = template.replace(PLACEHOLDER, 'x')
  return /[{}]/.test(bare) || !isHttpUrl(bare) ? 'must be an http(s) URL with a literal host' : null
}

export function parseGameList<T>(
  raw: unknown,
  key: string,
  max: number,
  parseOne: (entry: unknown, at: string, index: number) => T | string
): Parsed<T> {
  if (raw === undefined || raw === null) {
    return { value: undefined, warnings: [] }
  }
  if (!Array.isArray(raw)) {
    return { value: undefined, warnings: [`orchestratorGame.${key} must be a list`] }
  }
  const value: T[] = []
  const warnings: string[] = []
  raw.slice(0, max).forEach((entry, index) => {
    const parsed = parseOne(entry, `orchestratorGame.${key}[${index}]`, index)
    if (typeof parsed === 'string') {
      warnings.push(parsed)
    } else {
      value.push(parsed)
    }
  })
  if (raw.length > max) {
    warnings.push(`orchestratorGame.${key} keeps the first ${max} entries`)
  }
  return { value, warnings }
}

function parseLink(entry: unknown, at: string): OrchestratorGameLinkTemplate | string {
  if (!isRecord(entry) || typeof entry.label !== 'string' || typeof entry.url !== 'string') {
    return `${at} must be a mapping with label and url`
  }
  const url = entry.url.trim()
  const problem = templateProblem(url, (name) => GAME_LINK_PLACEHOLDERS.has(name))
  if (problem) {
    return `${at}.url ${problem}`
  }
  const label = shortText(entry.label, GAME_LINK_LABEL_MAX)
  return label ? { label, url } : `${at}.label must be 1 to ${GAME_LINK_LABEL_MAX} characters`
}

const compilePattern = (source: string): RegExp | null => {
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

// Why: `x|` always matches empty text, so its exec reports the pattern's group count.
const groupCountOf = (pattern: RegExp): number =>
  (new RegExp(`${pattern.source}|`).exec('')?.length ?? 1) - 1

function parseActivityRule(entry: unknown, at: string): OrchestratorGameActivityRule | string {
  if (!isRecord(entry)) {
    return `${at} must be a mapping with name, match and url`
  }
  const name = shortText(entry.name, GAME_LINK_LABEL_MAX)
  if (!name) {
    return `${at}.name must be 1 to ${GAME_LINK_LABEL_MAX} characters`
  }
  const tools = entry.tools
  if (tools !== undefined && (typeof tools !== 'string' || !TOOL_GLOB.test(tools))) {
    return `${at}.tools must be a tool name glob like mcp__tambora__*`
  }
  const match = entry.match
  if (typeof match !== 'string' || match.length === 0 || match.length > GAME_ACTIVITY_PATTERN_MAX) {
    return `${at}.match must be 1 to ${GAME_ACTIVITY_PATTERN_MAX} characters`
  }
  const pattern = compilePattern(match)
  if (!pattern) {
    return `${at}.match must be a valid regular expression`
  }
  if (pattern.test('')) {
    return `${at}.match must not match empty text`
  }
  const url = typeof entry.url === 'string' ? entry.url.trim() : ''
  const groups = groupCountOf(pattern)
  const problem = templateProblem(url, (one) => /^\d$/.test(one) && Number(one) <= groups)
  if (problem) {
    return `${at}.url ${problem}`
  }
  return { name, ...(tools ? { tools } : {}), match, url }
}

export function parseGameLinkTemplates(raw: unknown): Parsed<OrchestratorGameLinkTemplate> {
  return parseGameList(raw, 'links', GAME_LINKS_MAX, parseLink)
}

export function parseGameActivityRules(raw: unknown): Parsed<OrchestratorGameActivityRule> {
  return parseGameList(raw, 'activity', GAME_ACTIVITY_RULES_MAX, parseActivityRule)
}

export const toolGlobPattern = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i'
  )

export function compileGameActivityRule(
  rule: OrchestratorGameActivityRule
): CompiledGameActivityRule | null {
  const match = compilePattern(rule.match)
  if (!match) {
    return null
  }
  return {
    name: rule.name,
    tools: rule.tools ? toolGlobPattern(rule.tools) : null,
    match,
    url: rule.url,
    id: '{0}'
  }
}

/** Fills each placeholder URL-encoded; null when one has no value or the result is not http(s). */
export function renderGameUrlTemplate(
  template: string,
  values: Readonly<Record<string, string | undefined>>
): string | null {
  let missing = false
  const url = template.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name]
    if (!value) {
      missing = true
      return ''
    }
    return encodeURIComponent(value)
  })
  return !missing && isHttpUrl(url) ? url : null
}

export function matchGameActivity(
  rules: readonly CompiledGameActivityRule[],
  call: { toolName: string; input: string; result: string }
): GameActivityMatch | null {
  const text = `${call.input}\n${call.result}`.slice(0, GAME_ACTIVITY_TEXT_MAX)
  for (const rule of rules) {
    if (rule.tools && !rule.tools.test(call.toolName)) {
      continue
    }
    const found = rule.match.exec(text)
    if (!found) {
      continue
    }
    const values = Object.fromEntries(found.map((group, index) => [String(index), group]))
    const url = renderGameUrlTemplate(rule.url, values)
    const id = rule.id.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '')
    if (url && id) {
      return { name: rule.name, id, url }
    }
  }
  return null
}
