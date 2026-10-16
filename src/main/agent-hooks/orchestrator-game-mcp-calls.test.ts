import { describe, expect, it } from 'vitest'
import {
  GAME_MCP_CALLS_PER_PANE,
  GAME_MCP_INPUT_MAX,
  GameMcpCallLog,
  mcpToolCallOfHookBody
} from './orchestrator-game-mcp-calls'

const pre = {
  hookEventName: 'PreToolUse',
  toolUseId: 'tu1',
  toolName: 'mcp__tambora__create_test_run',
  input: '{"project_key":"CIN"}',
  at: 1
}

describe('GameMcpCallLog', () => {
  it('keeps an MCP call running until its PostToolUse lands with the result', () => {
    const log = new GameMcpCallLog()
    log.record('tab:a', pre)
    expect(log.callsOf('tab:a')).toEqual([
      {
        toolUseId: 'tu1',
        toolName: 'mcp__tambora__create_test_run',
        input: '{"project_key":"CIN"}',
        result: '',
        running: true,
        at: 1
      }
    ])

    log.record('tab:a', {
      hookEventName: 'PostToolUse',
      toolUseId: 'tu1',
      toolName: 'mcp__tambora__create_test_run',
      result: 'Created TR-CIN-12',
      at: 2
    })
    expect(log.callsOf('tab:a')).toEqual([
      {
        toolUseId: 'tu1',
        toolName: 'mcp__tambora__create_test_run',
        input: '{"project_key":"CIN"}',
        result: 'Created TR-CIN-12',
        running: false,
        at: 2
      }
    ])
  })

  it('ignores tools that are not MCP and ends running calls on failure or stop', () => {
    const log = new GameMcpCallLog()
    log.record('tab:a', { ...pre, toolName: 'Bash' })
    expect(log.callsOf('tab:a')).toEqual([])

    log.record('tab:a', pre)
    log.record('tab:a', { hookEventName: 'PostToolUseFailure', toolUseId: 'tu1', at: 2 })
    expect(log.callsOf('tab:a')[0]?.running).toBe(false)

    log.record('tab:a', { ...pre, toolUseId: 'tu2', at: 3 })
    log.record('tab:a', { hookEventName: 'Stop', at: 4 })
    expect(log.callsOf('tab:a').map((call) => call.running)).toEqual([false, false])
  })

  it('keeps the newest calls per pane and bounds what each one holds', () => {
    const log = new GameMcpCallLog()
    for (let index = 0; index < GAME_MCP_CALLS_PER_PANE + 2; index++) {
      log.record('tab:a', { ...pre, toolUseId: `tu${index}`, input: 'x'.repeat(9000), at: index })
    }
    const calls = log.callsOf('tab:a')

    expect(calls).toHaveLength(GAME_MCP_CALLS_PER_PANE)
    expect(calls[0]?.toolUseId).toBe(`tu${GAME_MCP_CALLS_PER_PANE + 1}`)
    expect(calls[0]?.input).toHaveLength(GAME_MCP_INPUT_MAX)
  })

  it('forgets a pane', () => {
    const log = new GameMcpCallLog()
    log.record('tab:a', pre)
    log.forget('tab:a')

    expect(log.callsOf('tab:a')).toEqual([])
  })
})

describe('mcpToolCallOfHookBody', () => {
  it('reads the tool input and result of a hook body whose payload is an object or a JSON string', () => {
    const payload = {
      tool_name: 'mcp__tambora__x',
      tool_input: { run: 'TR-CIN-12' },
      tool_response: { content: [{ type: 'text', text: 'ok' }] }
    }
    const call = { input: '{"run":"TR-CIN-12"}', result: 'ok' }

    expect(mcpToolCallOfHookBody({ payload })).toEqual(call)
    expect(mcpToolCallOfHookBody({ payload: JSON.stringify(payload) })).toEqual(call)
    expect(mcpToolCallOfHookBody({ payload: 'not json' })).toEqual({ input: '', result: '' })
    expect(mcpToolCallOfHookBody(null)).toEqual({ input: '', result: '' })
  })
})
