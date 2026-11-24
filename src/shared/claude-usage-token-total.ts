type ClaudeTokenCounts = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

// Why: cache read/write is most of Claude's volume; lists ranked or shown without it disagree with the cards.
export function getClaudeTotalTokens(row: ClaudeTokenCounts): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
}
