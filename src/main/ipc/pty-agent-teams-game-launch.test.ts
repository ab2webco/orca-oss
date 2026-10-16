import { describe, expect, it } from 'vitest'
import { withAgentTeamsGameCommand } from './pty-agent-teams-game-launch'

const game = { args: ['--plugin-dir', '/Apps/Orca Lab.app/orca-game'], env: {} }

describe('withAgentTeamsGameCommand', () => {
  it('inserts the quoted plugin dir after the executable', () => {
    expect(withAgentTeamsGameCommand('claude --teammate-mode auto', game)).toBe(
      "claude '--plugin-dir' '/Apps/Orca Lab.app/orca-game' --teammate-mode auto"
    )
  })

  it('does not add the plugin dir twice', () => {
    const once = withAgentTeamsGameCommand('claude', game)
    expect(withAgentTeamsGameCommand(once, game)).toBe(once)
  })

  it('leaves the command alone without a game or a command', () => {
    expect(withAgentTeamsGameCommand('claude', { args: [], env: {} })).toBe('claude')
    expect(withAgentTeamsGameCommand(undefined, game)).toBeUndefined()
  })
})
