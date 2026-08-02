import { describe, expect, it } from 'vitest'
import { buildClaudeTerminalSwitchLaunchCommand } from './claude-terminal-switch-resume-command'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'

describe('buildClaudeTerminalSwitchLaunchCommand', () => {
  it('preserves the captured argv, including --dangerously-skip-permissions, exactly once', () => {
    const built = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: SESSION_ID,
      launchConfig: {
        agentCommand: 'claude --dangerously-skip-permissions',
        agentArgs: '--dangerously-skip-permissions',
        agentEnv: {}
      },
      shell: 'posix',
      platform: 'darwin',
      configDir: '/vault/account-target/auth'
    })
    expect(built.ok).toBe(true)
    const command = built.ok ? built.command : ''
    expect(command.match(/--dangerously-skip-permissions/g)).toHaveLength(1)
    expect(command).toContain(`'--resume' '${SESSION_ID}'`)
    expect(command).toContain("export CLAUDE_CONFIG_DIR='/vault/account-target/auth'")
  })

  it('refuses a launch configuration with no recorded agent command instead of guessing defaults', () => {
    const built = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: SESSION_ID,
      launchConfig: { agentArgs: '', agentEnv: {} },
      shell: 'posix',
      platform: 'darwin',
      configDir: '/vault/account-target/auth'
    })
    expect(built).toEqual({ ok: false, reason: 'missing-launch-config' })
  })

  it('omits the config-dir export when the shell already exports the universe', () => {
    const built = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: SESSION_ID,
      launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
      shell: 'posix',
      platform: 'darwin',
      configDir: null
    })
    expect(built.ok && built.command).toBe(`claude '--resume' '${SESSION_ID}'`)
  })
})
