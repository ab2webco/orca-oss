/** Flags `game launch` and `game wave` share: they override the lead config per member. */
export const GAME_LAUNCH_OVERRIDE_FLAGS = [
  'agent',
  'account',
  'model',
  'effort',
  'skip-mcp-check'
] as const

export const GAME_LAUNCH_OVERRIDE_NOTES = [
  "--agent, --model and --effort override the lead config for this member; another agent than the lead's gets its own default model unless --model is given. --effort needs a model.",
  "--account (email or id from `orca game accounts`) pins a claude or codex member to that managed account; another provider's account, or an agent with no managed accounts, is refused.",
  'Refused, before anything starts, when the host and account the member would run on lack an MCP server listed in orchestratorGame.orchestrator.mcpServers; the refusal names each one. It warns and launches when the host cannot tell (a Codex member, an SSH repo, an older Orca there). --skip-mcp-check launches without checking.'
]
