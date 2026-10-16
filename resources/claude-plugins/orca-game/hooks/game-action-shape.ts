import type { GameAction, GameMcpCall } from '../types'

// Mirrors Orca's own limits in src/shared/orchestrator-game-actions.ts.
export const GAME_ACTIONS_MAX = 6
const LABEL_MAX = 24
const ID_MAX = 64
export const GAME_PROMPT_MAX = 2000
// Why spaces and dots: /mcp names servers like `claude.ai Gmail`; tools are plain identifiers.
const MCP_SERVER = /^[A-Za-z0-9 _.-]{1,64}$/
const MCP_TOOL = /^[A-Za-z0-9_.-]{1,64}$/

type Shape = Record<string, unknown>

const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const trimmedOf = (value: unknown, max: number): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' || text.length > max ? undefined : text
}

/** A prompt of 1 to 2000 characters, else none. */
export const gamePromptOf = (value: unknown): string | undefined =>
  trimmedOf(value, GAME_PROMPT_MAX)

const mcpCallOf = (value: unknown): GameMcpCall | undefined => {
  if (!isShape(value) || typeof value.server !== 'string' || typeof value.tool !== 'string') {
    return undefined
  }
  const server = value.server.trim()
  const tool = value.tool.trim()
  if (!MCP_SERVER.test(server) || !MCP_TOOL.test(tool)) {
    return undefined
  }
  if (value.args === undefined) {
    return { server, tool }
  }
  return isShape(value.args) ? { server, tool, args: value.args } : undefined
}

const actionOf = (value: unknown): GameAction[] => {
  if (!isShape(value) || (value.prompt === undefined) === (value.mcp === undefined)) {
    return []
  }
  const id = trimmedOf(value.id, ID_MAX)
  const label = trimmedOf(value.label, LABEL_MAX)
  if (id === undefined || label === undefined) {
    return []
  }
  if (value.mcp !== undefined) {
    const mcp = mcpCallOf(value.mcp)
    return mcp === undefined ? [] : [{ id, label, mcp }]
  }
  const prompt = gamePromptOf(value.prompt)
  return prompt === undefined ? [] : [{ id, label, prompt }]
}

/** The project's buttons; left out when there are none, as from a host older than them. */
export const gameActionsOf = (value: unknown): { actions?: GameAction[] } => {
  if (!Array.isArray(value)) {
    return {}
  }
  const seen = new Set<string>()
  const actions = value
    .slice(0, GAME_ACTIONS_MAX)
    .flatMap(actionOf)
    .filter((one) => !seen.has(one.id) && seen.add(one.id))
  return actions.length === 0 ? {} : { actions }
}
