// Why: an Orca pane exports pointers to the real app state, and suites that stub them only until
// afterEach let late async work write there. From panes, tests wrote fixture logins into account
// vaults and /tmp entries into userData's Codex backfill audit log (ORCA-1430). CI sets none.
const PANE_STATE_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ORCA_USER_DATA_PATH',
  'CODEX_HOME',
  'ORCA_CODEX_HOME'
] as const

for (const key of PANE_STATE_ENV_KEYS) {
  delete process.env[key]
}
