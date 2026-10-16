import { describe, expect, it } from 'vitest'
import { withAgentTeamsGameCommand, withDevOrcaCli } from './pty-agent-teams-game-launch'

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

describe('withDevOrcaCli', () => {
  const devCli = '/Users/me/Library/Application Support/orca-dev/cli/bin/orca'

  it('points a bare orca launch at the dev build CLI', () => {
    expect(withDevOrcaCli('orca claude-teams --dangerously-skip-permissions', devCli)).toBe(
      "'/Users/me/Library/Application Support/orca-dev/cli/bin/orca' claude-teams --dangerously-skip-permissions"
    )
  })

  it('leaves other commands and a missing dev CLI alone', () => {
    expect(withDevOrcaCli('claude --teammate-mode auto', devCli)).toBe(
      'claude --teammate-mode auto'
    )
    expect(withDevOrcaCli('orca-dev claude-teams', devCli)).toBe('orca-dev claude-teams')
    expect(withDevOrcaCli('orca claude-teams', null)).toBe('orca claude-teams')
    expect(withDevOrcaCli(undefined, devCli)).toBeUndefined()
  })
})
