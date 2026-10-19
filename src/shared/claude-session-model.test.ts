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
})

describe('claudeSessionModelOfHook', () => {
  const noTranscript = (): undefined => undefined

  it('takes the model an interactive SessionStart announces, before any turn', () => {
    expect(
      claudeSessionModelOfHook(
        'SessionStart',
        { model: 'claude-sonnet-5-5', transcript_path: '/t.jsonl' },
        undefined,
        noTranscript
      )
    ).toEqual({ model: 'claude-sonnet-5-5' })
  })

  it('on Stop prefers the transcript turn over the cached model, and keeps the hook effort only as a fallback', () => {
    const read = (path: string) =>
      path === '/t.jsonl' ? { model: 'claude-opus-5-5', effort: 'medium' } : undefined
    expect(
      claudeSessionModelOfHook(
        'Stop',
        { transcript_path: '/t.jsonl', effort: { level: 'high' } },
        { model: 'claude-sonnet-5-5' },
        read
      )
    ).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
    expect(
      claudeSessionModelOfHook(
        'Stop',
        { transcript_path: '/none.jsonl', effort: { level: 'high' } },
        { model: 'claude-sonnet-5-5' },
        read
      )
    ).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  it('keeps the cached pick on a mid-turn event without reading the transcript', () => {
    let reads = 0
    const read = () => {
      reads += 1
      return { model: 'claude-opus-5-5' }
    }
    expect(
      claudeSessionModelOfHook(
        'PreToolUse',
        { transcript_path: '/t.jsonl' },
        { model: 'claude-sonnet-5-5', effort: 'low' },
        read
      )
    ).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' })
    expect(reads).toBe(0)
  })

  it('reads the transcript once for a pane it has no pick for, as after a restart', () => {
    expect(
      claudeSessionModelOfHook('PreToolUse', { transcript_path: '/t.jsonl' }, undefined, () => ({
        model: 'claude-opus-5-5',
        effort: 'xhigh'
      }))
    ).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(
      claudeSessionModelOfHook('PreToolUse', {}, undefined, () => ({ model: 'unused' }))
    ).toEqual({})
  })

  it('a new session drops the previous session pick', () => {
    expect(
      claudeSessionModelOfHook(
        'SessionStart',
        { transcript_path: '/new.jsonl' },
        { model: 'claude-opus-5-5', effort: 'high' },
        noTranscript
      )
    ).toEqual({})
  })
})
