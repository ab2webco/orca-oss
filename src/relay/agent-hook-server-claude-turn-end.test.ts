import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RelayAgentHookServer } from './agent-hook-server'
import type { AgentHookRelayEnvelope } from '../shared/agent-hook-relay'
import { makePaneKey } from '../shared/stable-pane-id'

const PANE_KEY = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const line = (record: unknown): string => `${JSON.stringify(record)}\n`

describe('RelayAgentHookServer Claude turn that ends without a closing Stop (ORCA-1108)', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('forwards done once the transcript shows the post-Stop continuation ended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-hook-claude-turn-end-'))
    dirs.push(dir)
    const transcriptPath = join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, line({ type: 'user', message: { content: 'go' } }))
    const forward = vi.fn<(envelope: AgentHookRelayEnvelope) => void>()
    const server = new RelayAgentHookServer({ endpointDir: dir, forward })
    await server.start()
    try {
      const { port, token } = server.getCoordinates()
      const post = async (payload: Record<string, unknown>): Promise<void> => {
        const response = await fetch(`http://127.0.0.1:${port}/hook/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': token },
          body: JSON.stringify({
            paneKey: PANE_KEY,
            tabId: 'tab-1',
            worktreeId: 'wt-1',
            payload: { session_id: 'member', transcript_path: transcriptPath, ...payload }
          })
        })
        expect(response.status).toBe(204)
      }

      await post({ hook_event_name: 'UserPromptSubmit', prompt: 'do the task' })
      await post({ hook_event_name: 'Stop' })
      await post({ hook_event_name: 'PreToolUse', tool_name: 'mcp__engram__mem_current_project' })
      expect(forward.mock.calls.at(-1)?.[0].payload.state).toBe('working')

      appendFileSync(
        transcriptPath,
        line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1' }] } }) +
          line({ type: 'system', subtype: 'turn_duration', durationMs: 900 })
      )
      await vi.waitFor(
        () => {
          expect(forward.mock.calls.at(-1)?.[0]).toMatchObject({
            hookEventName: 'Stop',
            payload: { state: 'done' }
          })
        },
        { timeout: 8_000, interval: 50 }
      )
    } finally {
      server.stop()
    }
  })
})
