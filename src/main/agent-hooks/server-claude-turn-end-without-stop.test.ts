import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentHookServer, _internals } from './server'
import { buildBody, PANE } from './server.test-fixtures'

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

const line = (record: unknown): string => `${JSON.stringify(record)}\n`
const TOOL_USE = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash' }] }
}
const TOOL_RESULT = {
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] }
}
const TURN_END = { type: 'system', subtype: 'turn_duration', durationMs: 2100 }

describe('Claude turn that ends without a closing Stop (ORCA-1108)', () => {
  let dir: string
  let transcriptPath: string
  let server: AgentHookServer

  beforeEach(async () => {
    _internals.resetCachesForTests()
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
    dir = mkdtempSync(join(tmpdir(), 'orca-claude-turn-end-'))
    transcriptPath = join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, line({ type: 'user', message: { content: 'go' } }))
    server = new AgentHookServer()
    await server.start({ env: 'production' })
  })

  afterEach(() => {
    server.stop()
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const post = async (payload: Record<string, unknown>): Promise<void> => {
    const env = server.buildPtyEnv()
    const response = await fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
      },
      body: JSON.stringify(
        buildBody({ session_id: 'member-session', transcript_path: transcriptPath, ...payload })
      )
    })
    expect(response.status).toBe(204)
  }
  const stateOfPane = (): string | undefined =>
    server.getStatusSnapshot().find((row) => row.paneKey === PANE)?.state

  // Why: a blocked Stop resumes the turn with tool hooks and no UserPromptSubmit; a hook that halts it leaves no second Stop.
  it('goes idle once the transcript shows the turn ended after a post-Stop tool hook', async () => {
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'do the task' })
    await post({ hook_event_name: 'Stop' })
    await post({ hook_event_name: 'PreToolUse', tool_name: 'mcp__engram__mem_current_project' })
    expect(stateOfPane()).toBe('working')

    appendFileSync(transcriptPath, line(TOOL_USE) + line(TOOL_RESULT) + line(TURN_END))

    await vi.waitFor(() => expect(stateOfPane()).toBe('done'), { timeout: 8_000, interval: 50 })
  })

  it('goes idle when the halted continuation also reported its PostToolUse', async () => {
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'do the task' })
    await post({ hook_event_name: 'Stop' })
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1' })
    await post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1' })
    appendFileSync(transcriptPath, line(TOOL_USE) + line(TOOL_RESULT) + line(TURN_END))

    await vi.waitFor(() => expect(stateOfPane()).toBe('done'), { timeout: 8_000, interval: 50 })
  })

  it('stays working while the continuation tool is still running', async () => {
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'do the task' })
    await post({ hook_event_name: 'Stop' })
    appendFileSync(transcriptPath, line(TURN_END))
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1' })
    appendFileSync(transcriptPath, line(TOOL_USE))

    await new Promise((resolve) => setTimeout(resolve, 3_500))
    expect(stateOfPane()).toBe('working')
  })

  it('a new turn after the Stop goes back to working and is never reset', async () => {
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'do the task' })
    await post({ hook_event_name: 'Stop' })
    appendFileSync(transcriptPath, line(TURN_END))
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'next message' })
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })

    await new Promise((resolve) => setTimeout(resolve, 3_500))
    expect(stateOfPane()).toBe('working')
  })
})
