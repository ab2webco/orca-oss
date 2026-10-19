import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHookListenerState,
  normalizeHookPayload,
  type HookListenerState
} from './agent-hook-listener'
import { PANE_KEY } from './agent-hook-listener-test-harness'

const assistantLine = (model: string, effort: string): string =>
  JSON.stringify({ type: 'assistant', effort, message: { role: 'assistant', model, content: [] } })

describe('Claude session model on status payloads', () => {
  let state: HookListenerState
  let dir: string

  beforeEach(() => {
    state = createHookListenerState()
    dir = mkdtempSync(join(tmpdir(), 'claude-session-model-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const send = (payload: Record<string, unknown>) =>
    normalizeHookPayload(state, 'claude', { paneKey: PANE_KEY, payload }, 'production')?.payload

  it('carries the SessionStart model on every later lead event, then the Stop turn model and effort', () => {
    const transcript = join(dir, 'session.jsonl')
    writeFileSync(transcript, '')
    expect(
      send({
        hook_event_name: 'SessionStart',
        source: 'startup',
        model: 'claude-sonnet-5-5',
        transcript_path: transcript
      })
    ).toMatchObject({ model: 'claude-sonnet-5-5' })
    expect(
      send({ hook_event_name: 'UserPromptSubmit', prompt: 'go', transcript_path: transcript })
    ).toMatchObject({ model: 'claude-sonnet-5-5' })

    writeFileSync(transcript, `${assistantLine('claude-opus-5-5', 'xhigh')}\n`)
    const stop = send({
      hook_event_name: 'Stop',
      transcript_path: transcript,
      effort: { level: 'high' }
    })
    expect(stop).toMatchObject({ state: 'done', model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('learns the model from the transcript for a pane first seen mid-session', () => {
    const transcript = join(dir, 'resumed.jsonl')
    writeFileSync(transcript, `${assistantLine('claude-haiku-5-5', 'medium')}\n`)
    expect(
      send({ hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: transcript })
    ).toMatchObject({ model: 'claude-haiku-5-5', effort: 'medium' })
  })

  it('a child event does not replace the lead model', () => {
    send({ hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5-5' })
    const childTranscript = join(dir, 'child.jsonl')
    writeFileSync(childTranscript, `${assistantLine('claude-haiku-5-5', 'low')}\n`)
    const child = send({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      agent_id: 'child-1',
      transcript_path: childTranscript
    })
    expect(child?.model ?? 'claude-opus-5-5').toBe('claude-opus-5-5')
    expect(send({ hook_event_name: 'UserPromptSubmit', prompt: 'next' })).toMatchObject({
      model: 'claude-opus-5-5'
    })
  })
})
