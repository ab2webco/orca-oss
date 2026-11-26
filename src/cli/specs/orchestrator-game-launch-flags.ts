/** Flags `game launch` and `game wave` share: they override the lead config per member. */
export const GAME_LAUNCH_OVERRIDE_FLAGS = [
  'agent',
  'account',
  'model',
  'effort',
  'kind',
  'skip-mcp-check'
] as const

export const GAME_LAUNCH_OVERRIDE_NOTES = [
  "--agent, --model and --effort override the lead config for this member; another agent than the lead's gets its own default model unless --model is given. --effort needs a model.",
  "--kind audit|implement|review|captures names the ticket's work: a Claude member that --model and orca.yaml leave unset starts on that kind's model (audit and captures: Sonnet 5.5 medium; implement and review: Opus 5.5 high), unpinned so a model router can still move it. Without --kind the kind is read from a clear word in the ticket title, else it is implement; the member card says which.",
  '--kind bug-fix|feature|review|live-check also names the playbook: bug-fix and feature launch as implement, live-check as captures, and when orchestratorGame.orchestrator.playbooks is set the brief links <playbooks>/<kind>.md (review and captures from the title too); with no playbook kind it links the folder.',
  "--account (email or id from `orca game accounts`) pins a claude or codex member to that managed account; another provider's account, or an agent with no managed accounts, is refused.",
  "Without --account a claude or codex member goes on its agent's freest managed account (accounts: auto, the default; accounts: default keeps Orca's own selection). It never falls back to the global login while managed accounts exist; with none at all one member runs there, and the result says so.",
  'Refused, before anything starts, when the host and account the member would run on lack an MCP server listed in orchestratorGame.orchestrator.mcpServers; the refusal names each one. It warns and launches when the host cannot tell (a Codex member, an SSH repo, an older Orca there). --skip-mcp-check launches without checking.'
]
