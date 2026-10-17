import type { McpToolResult } from 'claude-code'

import type { ActionRun, GameAction } from '../types'

// Mirrors GAME_PANEL_RESERVED_KEYS in src/shared/orchestrator-game-actions.ts.
export const PANEL_RESERVED_KEYS: ReadonlySet<string> = new Set([...'rpqgtiocwa', ...'123456789'])

/** Pane letters no menu, link or tile button takes, in the order actions without a key get them. */
export const ACTION_HOTKEYS: readonly string[] = [...'efhjklmnsuvxyzbd']

/** Each action's Panel key: its own when Orca sent one, else the next free letter of the pool. */
export const actionHotkeysOf = (actions: readonly GameAction[]): Map<string, string> => {
  const taken = new Set(actions.flatMap((one) => (one.key === undefined ? [] : [one.key])))
  const free = ACTION_HOTKEYS.filter((one) => !taken.has(one))
  const keys = new Map<string, string>()
  for (const action of actions) {
    const key = action.key ?? free.shift()
    if (key !== undefined) {
      keys.set(action.id, key)
    }
  }
  return keys
}

const MAX_LINES = 12
const MAX_LINE = 200

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((one) => one.trimEnd())
    .filter((one) => one.trim() !== '')
    .slice(0, MAX_LINES)
    .map((one) => one.slice(0, MAX_LINE))

/** What an MCP action's call answered, as the few lines the Panel draws under it. */
export const actionResultOf = (result: McpToolResult): ActionRun => ({
  status: result.isError ? 'error' : 'done',
  lines: linesOf(
    result.content
      .flatMap((block) =>
        block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
      )
      .join('\n')
  )
})

export const actionErrorOf = (error: unknown): ActionRun => ({
  status: 'error',
  lines: linesOf(error instanceof Error ? error.message : String(error))
})
