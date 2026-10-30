import type { TuiAgent } from './tui-agent'

// Why: Claude's ghost-text suggestions in a member's input read as owner input to whoever reads the pane (ORCA-859).
export const GAME_MEMBER_CLAUDE_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false'
}

/** The agent env a game member launches with; any other launch keeps its env unchanged. */
export function gameMemberAgentEnvOf(
  agent: TuiAgent,
  env: Record<string, string>,
  gameMember: boolean | undefined
): Record<string, string> {
  return gameMember && agent === 'claude' ? { ...env, ...GAME_MEMBER_CLAUDE_ENV } : env
}
