import { describe, expect, it } from 'vitest'
import {
  claudeSessionModelOfHook,
  claudeSessionModelOfTranscriptLine
} from './claude-session-model'

const assistantLine = (model: string, effort?: string): string =>
  JSON.stringify({
    type: 'assistant',
    requestedModel: model,
    ...(effort ? { effort } : {}),
    message: { role: 'assistant', model, content: [] }
  })

describe('claudeSessionModelOfTranscriptLine', () => {
  it('reads the model and effort an assistant turn ran on', () => {
    expect(claudeSessionModelOfTranscriptLine(assistantLine('claude-opus-5-5', 'high'))).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high'
    })
  })

  it('skips user lines, synthetic messages and unreadable lines', () => {
    expect(
      claudeSessionModelOfTranscriptLine(JSON.stringify({ type: 'user', message: {} }))
    ).toBeUndefined()
    expect(claudeSessionModelOfTranscriptLine(assistantLine('<synthetic>'))).toBeUndefined()
    expect(claudeSessionModelOfTranscriptLine('{not json')).toBeUndefined()
  })

  it('skips a sidechain line, which a sub-agent ran on its own model', () => {
    const line = JSON.parse(assistantLine('claude-haiku-5-5', 'low')) as Record<string, unknown>
    expect(
      claudeSessionModelOfTranscriptLine(JSON.stringify({ ...line, isSidechain: true }))
    ).toBeUndefined()
  })
})

describe('claudeSessionModelOfHook', () => {
  const transcriptOf = (
    files: Record<string, { bytes: number; turn?: { model?: string; effort?: string } }>
  ) => {
    const reads: string[] = []
    return {
      reads,
      transcript: {
        bytesOf: (path: string) => files[path]?.bytes,
        read: (path: string) => {
          reads.push(path)
          return files[path]?.turn
        }
      }
    }
  }
  const none = transcriptOf({}).transcript

  it('takes the model an interactive SessionStart announces, before any turn', () => {
    expect(
      claudeSessionModelOfHook(
        'SessionStart',
        { model: 'claude-sonnet-5-5', transcript_path: '/t.jsonl' },
        undefined,
        none
      )
    ).toMatchObject({ model: 'claude-sonnet-5-5' })
  })

  it('on Stop prefers the transcript turn over the cached model, and keeps the hook effort only as a fallback', () => {
    const { transcript } = transcriptOf({
      '/t.jsonl': { bytes: 10, turn: { model: 'claude-opus-5-5', effort: 'medium' } },
      '/none.jsonl': { bytes: 10 }
    })
    expect(
      claudeSessionModelOfHook(
        'Stop',
        { transcript_path: '/t.jsonl', effort: { level: 'high' } },
        { model: 'claude-sonnet-5-5' },
        transcript
      )
    ).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
    expect(
      claudeSessionModelOfHook(
        'Stop',
        { transcript_path: '/none.jsonl', effort: { level: 'high' } },
        { model: 'claude-sonnet-5-5' },
        transcript
      )
    ).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  // Why: a member works its ticket in one long turn, and a router switches the model per step.
  it('reads the step a router switched mid-turn, as soon as the transcript grows', () => {
    const files = { '/t.jsonl': { bytes: 10, turn: { model: 'claude-sonnet-5-5' } } }
    const { transcript } = transcriptOf(files)
    const started = claudeSessionModelOfHook(
      'SessionStart',
      { model: 'claude-sonnet-5-5', transcript_path: '/t.jsonl' },
      undefined,
      transcript
    )
    files['/t.jsonl'] = { bytes: 90, turn: { model: 'claude-opus-5-5', effort: 'high' } }
    expect(
      claudeSessionModelOfHook(
        'PostToolUse',
        { transcript_path: '/t.jsonl', effort: { level: 'medium' } },
        started,
        transcript
      )
    ).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('does not re-read an unchanged transcript, and keeps the served effort over the hook turn effort', () => {
    const { transcript, reads } = transcriptOf({
      '/t.jsonl': { bytes: 50, turn: { model: 'claude-opus-5-5', effort: 'high' } }
    })
    const first = claudeSessionModelOfHook(
      'PreToolUse',
      { transcript_path: '/t.jsonl' },
      undefined,
      transcript
    )
    const second = claudeSessionModelOfHook(
      'PostToolUse',
      { transcript_path: '/t.jsonl', effort: { level: 'medium' } },
      first,
      transcript
    )
    expect(second).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
    expect(reads).toEqual(['/t.jsonl'])
  })

  it('reads the transcript for a pane it has no pick for, as after a restart', () => {
    const { transcript } = transcriptOf({
      '/t.jsonl': { bytes: 5, turn: { model: 'claude-opus-5-5', effort: 'xhigh' } }
    })
    expect(
      claudeSessionModelOfHook('PreToolUse', { transcript_path: '/t.jsonl' }, undefined, transcript)
    ).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(claudeSessionModelOfHook('PreToolUse', {}, undefined, transcript)).toEqual({})
  })

  it('a new session drops the previous session pick', () => {
    expect(
      claudeSessionModelOfHook(
        'SessionStart',
        { transcript_path: '/new.jsonl' },
        { model: 'claude-opus-5-5', effort: 'high', served: { model: 'claude-opus-5-5' } },
        none
      )
    ).toEqual({})
  })
})
