import { describe, expect, it } from 'vitest'
import { decodeTranscriptModelUsage } from './transcript-model-usage'

const row = (usage: Record<string, number>, model = 'claude-opus-5'): string =>
  JSON.stringify({ type: 'assistant', message: { model, usage } })

describe('decodeTranscriptModelUsage', () => {
  it('counts the cache as context, not just the fresh input', () => {
    // A cached turn reports 2 fresh tokens against 746k read from cache; input
    // alone would read as an almost empty window.
    const usage = decodeTranscriptModelUsage(
      row({ input_tokens: 2, cache_read_input_tokens: 746_155, cache_creation_input_tokens: 658 })
    )
    expect(usage).toEqual({ model: 'claude-opus-5', contextTokens: 746_815 })
  })

  it('ignores rows that are not an assistant turn with usage', () => {
    expect(decodeTranscriptModelUsage(JSON.stringify({ type: 'user' }))).toBeNull()
    expect(decodeTranscriptModelUsage('not json')).toBeNull()
    expect(decodeTranscriptModelUsage(JSON.stringify({ message: { usage: null } }))).toBeNull()
  })

  it('reports the tokens even when the row omits the model', () => {
    const usage = decodeTranscriptModelUsage(
      JSON.stringify({ message: { usage: { input_tokens: 10 } } })
    )
    expect(usage).toEqual({ model: null, contextTokens: 10 })
  })
})
