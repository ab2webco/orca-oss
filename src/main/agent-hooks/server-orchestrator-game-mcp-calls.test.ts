import { afterEach, describe, expect, it } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const PANE_KEY = makePaneKey('game-mcp', '11111111-1111-4111-8111-111111111111')

function postHook(port: number, token: string, payload: Record<string, unknown>) {
  return fetch(`http://127.0.0.1:${port}/hook/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': token },
    body: JSON.stringify({ paneKey: PANE_KEY, payload })
  })
}

describe('AgentHookServer game MCP calls', () => {
  const servers: AgentHookServer[] = []
  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop()
    }
  })

  it('keeps the input and result of a local MCP call', async () => {
    const server = new AgentHookServer()
    servers.push(server)
    await server.start({ env: 'production' })
    const env = server.buildPtyEnv()
    const port = Number(env.ORCA_AGENT_HOOK_PORT)
    const call = {
      session_id: 'session-a',
      tool_name: 'mcp__tambora__add_test_run_results',
      tool_use_id: 'tu1',
      tool_input: { test_run_code: 'TR-CIN-12' }
    }

    await postHook(port, env.ORCA_AGENT_HOOK_TOKEN, { hook_event_name: 'PreToolUse', ...call })
    expect(server.gameMcpCallsOf(PANE_KEY)).toEqual([
      expect.objectContaining({ input: '{"test_run_code":"TR-CIN-12"}', running: true })
    ])

    await postHook(port, env.ORCA_AGENT_HOOK_TOKEN, {
      hook_event_name: 'PostToolUse',
      ...call,
      tool_response: { content: [{ type: 'text', text: 'Recorded 3 results' }] }
    })
    expect(server.gameMcpCallsOf(PANE_KEY)).toEqual([
      expect.objectContaining({ result: 'Recorded 3 results', running: false })
    ])
  })

  it('keeps the result of a relayed MCP call, whose input never crosses the relay', () => {
    const server = new AgentHookServer()
    servers.push(server)
    server.ingestRemote(
      {
        source: 'claude',
        paneKey: PANE_KEY,
        hookEventName: 'PostToolUse',
        toolUseId: 'tu1',
        payload: {
          state: 'working',
          prompt: 'run the suite',
          agentType: 'claude',
          toolName: 'mcp__tambora__create_test_run',
          lastAssistantMessage: 'Created TR-CIN-12'
        }
      },
      'ssh-1'
    )

    expect(server.gameMcpCallsOf(PANE_KEY)).toEqual([
      expect.objectContaining({
        toolName: 'mcp__tambora__create_test_run',
        input: '',
        result: 'Created TR-CIN-12',
        running: false
      })
    ])
  })
})
