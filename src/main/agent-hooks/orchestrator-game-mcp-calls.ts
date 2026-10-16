import { extractToolResponseText, parseAgentHookJson } from '../../shared/agent-hook-listener'

/** An agent's recent MCP tool call, kept in main memory only so game rules can read its ids. */
export type GameMcpCall = {
  toolUseId: string | null
  toolName: string
  input: string
  result: string
  running: boolean
  at: number
}

export type GameMcpHookEvent = {
  hookEventName?: string
  toolUseId?: string
  toolName?: string
  input?: string
  result?: string
  at: number
}

export const GAME_MCP_CALLS_PER_PANE = 8
export const GAME_MCP_INPUT_MAX = 2048
export const GAME_MCP_RESULT_MAX = 4096
const GAME_MCP_PANES_MAX = 64

const isMcpTool = (toolName: string | undefined): toolName is string =>
  toolName?.startsWith('mcp__') === true

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function hookPayloadOf(body: unknown): Record<string, unknown> | null {
  const payload = isRecord(body) ? body.payload : undefined
  if (typeof payload !== 'string') {
    return isRecord(payload) ? payload : null
  }
  try {
    const parsed = parseAgentHookJson(payload)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const boundedJson = (value: unknown): string => {
  try {
    return (JSON.stringify(value) ?? '').slice(0, GAME_MCP_INPUT_MAX)
  } catch {
    return ''
  }
}

/** The tool input (bounded JSON) and result text of a raw Claude hook body; '' for what it lacks. */
export function mcpToolCallOfHookBody(body: unknown): { input: string; result: string } {
  const payload = hookPayloadOf(body)
  if (!payload) {
    return { input: '', result: '' }
  }
  return {
    input: payload.tool_input === undefined ? '' : boundedJson(payload.tool_input),
    result: (extractToolResponseText(payload.tool_response) ?? '').slice(0, GAME_MCP_RESULT_MAX)
  }
}

export class GameMcpCallLog {
  private readonly callsByPane = new Map<string, GameMcpCall[]>()

  callsOf(paneKey: string): readonly GameMcpCall[] {
    return this.callsByPane.get(paneKey) ?? []
  }

  forget(paneKey: string): void {
    this.callsByPane.delete(paneKey)
  }

  record(paneKey: string, event: GameMcpHookEvent): void {
    const calls = this.callsByPane.get(paneKey)
    const hook = event.hookEventName
    if (hook === 'Stop' || hook === 'StopFailure' || hook === 'SessionEnd') {
      calls?.forEach((call) => (call.running = false))
      return
    }
    if (hook === 'PostToolUseFailure') {
      const failed = calls?.find((call) => call.toolUseId === (event.toolUseId ?? null))
      if (failed) {
        failed.running = false
      }
      return
    }
    if ((hook !== 'PreToolUse' && hook !== 'PostToolUse') || !isMcpTool(event.toolName)) {
      return
    }
    const next = calls ?? []
    const existing = event.toolUseId
      ? next.find((call) => call.toolUseId === event.toolUseId)
      : undefined
    const call: GameMcpCall = existing ?? {
      toolUseId: event.toolUseId ?? null,
      toolName: event.toolName,
      input: '',
      result: '',
      running: true,
      at: event.at
    }
    if (event.input) {
      call.input = event.input.slice(0, GAME_MCP_INPUT_MAX)
    }
    if (hook === 'PostToolUse') {
      call.running = false
      call.result = (event.result ?? '').slice(0, GAME_MCP_RESULT_MAX)
    }
    call.at = event.at
    const rest = next.filter((one) => one !== call)
    // Why: re-inserting keeps the Map in recency order, so the oldest pane is evicted first.
    this.callsByPane.delete(paneKey)
    this.callsByPane.set(paneKey, [call, ...rest].slice(0, GAME_MCP_CALLS_PER_PANE))
    for (const stale of this.callsByPane.keys()) {
      if (this.callsByPane.size <= GAME_MCP_PANES_MAX) {
        break
      }
      this.callsByPane.delete(stale)
    }
  }
}
