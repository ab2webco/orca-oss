import type { McpToolResult } from 'claude-code'

import type { ActionRun } from '../types'

/** Pane letters no menu, link or tile button takes. */
export const ACTION_HOTKEYS = ['e', 'f', 'h', 'j', 'k', 'l'] as const

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
