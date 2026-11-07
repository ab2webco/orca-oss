import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claudeMissingStopOfHookBody,
  claudeTranscriptTurnEnded
} from './claude-turn-end-transcript'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs.length = 0
})

function transcriptOf(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-turn-end-'))
  dirs.push(dir)
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(''))
  return path
}

const USER = { type: 'user', message: { content: 'go' } }
const ASSISTANT = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1' }] } }
const TURN_END = { type: 'system', subtype: 'turn_duration', durationMs: 1200 }

describe('claudeTranscriptTurnEnded', () => {
  it('reads a turn as ended when turn_duration follows its last message, past bookkeeping lines', () => {
    const path = transcriptOf([
      USER,
      ASSISTANT,
      { type: 'attachment', attachment: { type: 'hook_stopped_continuation' } },
      TURN_END,
      { type: 'last-prompt' },
      { type: 'mode' }
    ])
    expect(claudeTranscriptTurnEnded(path)).toBe(true)
  })

  it('keeps a turn open after a blocked Stop, which writes only stop_hook_summary', () => {
    const path = transcriptOf([
      USER,
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'user', message: { content: 'Stop hook feedback: run it' } },
      { type: 'system', subtype: 'stop_hook_summary' }
    ])
    expect(claudeTranscriptTurnEnded(path)).toBe(false)
  })

  it('keeps a turn open while a tool started after the previous turn ended', () => {
    expect(claudeTranscriptTurnEnded(transcriptOf([USER, TURN_END, ASSISTANT]))).toBe(false)
  })

  it('ignores sidechain lines and a missing transcript', () => {
    const path = transcriptOf([USER, TURN_END, { ...ASSISTANT, isSidechain: true }])
    expect(claudeTranscriptTurnEnded(path)).toBe(true)
    expect(claudeTranscriptTurnEnded(join(tmpdir(), 'no-such-claude-transcript.jsonl'))).toBe(false)
  })
})

describe('claudeMissingStopOfHookBody', () => {
  it('re-labels a tool hook body as a Stop without its tool fields', () => {
    const missing = claudeMissingStopOfHookBody({
      paneKey: 'pane',
      payload: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's1',
        transcript_path: '/t.jsonl',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'toolu_1'
      })
    })
    expect(missing).toEqual({
      transcriptPath: '/t.jsonl',
      stopBody: {
        paneKey: 'pane',
        payload: { hook_event_name: 'Stop', session_id: 's1', transcript_path: '/t.jsonl' }
      }
    })
  })

  it('returns null when the hook names no transcript', () => {
    expect(claudeMissingStopOfHookBody({ payload: { hook_event_name: 'PreToolUse' } })).toBeNull()
  })
})
