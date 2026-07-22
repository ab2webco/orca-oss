import { isAnteHeadlessOneShotCommand } from './ante-headless-command'
import { isClaudeHeadlessOneShotCommand } from './claude-headless-command'
import type { TuiAgent } from './types'

export function isHeadlessOneShotAgentCommand(agent: TuiAgent, tokens: readonly string[]): boolean {
  // Why: claude-zai wraps the real claude CLI, so its one-shot flags are Claude's.
  if (agent === 'claude' || agent === 'claude-zai') {
    return isClaudeHeadlessOneShotCommand(tokens)
  }
  return agent === 'ante' && isAnteHeadlessOneShotCommand(tokens)
}

type AgentCommandRecognition = { agent: TuiAgent } | null

export function filterHeadlessOneShotAgentCommand<T extends AgentCommandRecognition>(
  recognition: T,
  tokens: readonly string[]
): T | null {
  if (recognition && isHeadlessOneShotAgentCommand(recognition.agent, tokens)) {
    return null
  }
  return recognition
}
