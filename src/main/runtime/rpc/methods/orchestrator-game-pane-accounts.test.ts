import { describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_PANE_ACCOUNTS_METHODS } from './orchestrator-game-pane-accounts'

describe('game.paneAccounts', () => {
  it("answers each pane's account the way game.state names a member's", async () => {
    const getGamePaneAccounts = vi.fn().mockResolvedValue({ accounts: [] })
    const method = ORCHESTRATOR_GAME_PANE_ACCOUNTS_METHODS[0]!
    const panes = [{ paneKey: 'tab:leaf', agentType: 'claude', worktreeId: 'repo::/w' }]

    await method.handler(method.params!.parse({ panes }), {
      runtime: { getGamePaneAccounts }
    } as never)

    expect(method.name).toBe('game.paneAccounts')
    expect(getGamePaneAccounts).toHaveBeenCalledWith(panes)
  })
})
