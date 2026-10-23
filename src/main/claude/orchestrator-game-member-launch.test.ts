import { describe, expect, it } from 'vitest'
import { withOrchestratorGameMemberLaunch } from './orchestrator-game-member-launch'

const GAME = {
  args: ['--plugin-dir', '/app/claude-plugins/orca-game'],
  env: { ORCA_GAME_MODE: 'on', ORCA_GAME_ROLE: 'member' }
}

const startup = (launchCommand: string, agentCommand = 'claude') => ({
  launchCommand,
  env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' },
  launchConfig: { agentCommand, agentArgs: '', agentEnv: { A: '1' } },
  expectedProcess: 'claude'
})

describe('withOrchestratorGameMemberLaunch', () => {
  it('puts the plugin right after claude, keeping the model and the env it had', () => {
    const plan = withOrchestratorGameMemberLaunch(startup("claude --model 'opus'"), GAME, 'posix')

    expect(plan.launchCommand).toBe(
      "claude '--plugin-dir' '/app/claude-plugins/orca-game' --model 'opus'"
    )
    expect(plan.env).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'high', ...GAME.env })
    expect(plan.expectedProcess).toBe('claude')
  })

  it('carries the game into the launch config a woken member relaunches from', () => {
    const plan = withOrchestratorGameMemberLaunch(startup('claude'), GAME, 'posix')

    expect(plan.launchConfig.agentCommand).toBe(
      "claude '--plugin-dir' '/app/claude-plugins/orca-game'"
    )
    expect(plan.launchConfig.agentEnv).toEqual({ A: '1', ...GAME.env })
  })

  it('leaves a launch alone when the game does not load', () => {
    const plain = startup('claude')
    expect(withOrchestratorGameMemberLaunch(plain, { args: [], env: {} }, 'posix')).toBe(plain)
  })

  it('never touches a codex member or a wrapped command it cannot place args in', () => {
    const codex = startup("codex --model 'gpt-5'", 'codex')
    const wrapped = startup('env FOO=1 claude && echo done')

    expect(withOrchestratorGameMemberLaunch(codex, GAME, 'posix')).toBe(codex)
    expect(withOrchestratorGameMemberLaunch(wrapped, GAME, 'posix')).toBe(wrapped)
  })

  it('quotes the plugin dir for the pane shell on Windows', () => {
    const plan = withOrchestratorGameMemberLaunch(
      startup('claude'),
      { ...GAME, args: ['--plugin-dir', 'C:\\Orca\\orca-game'] },
      'powershell'
    )

    expect(plan.launchCommand).toBe("claude '--plugin-dir' 'C:\\Orca\\orca-game'")
  })
})
