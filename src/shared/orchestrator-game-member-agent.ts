/** Which managed-account roster a member agent runs on; only Claude and Codex have one in Orca. */
export type GameAccountProvider = 'claude' | 'codex'

export const GAME_ACCOUNT_PROVIDER_LABELS: Readonly<Record<GameAccountProvider, string>> = {
  claude: 'Claude',
  codex: 'Codex'
}

export function accountProviderOfAgent(
  agent: string | null | undefined
): GameAccountProvider | null {
  return agent === 'claude' || agent === 'codex' ? agent : null
}
