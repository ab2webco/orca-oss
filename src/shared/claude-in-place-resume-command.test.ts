import { describe, expect, it } from 'vitest'
import { buildClaudeInPlaceResumeCommand } from './claude-in-place-resume-command'

describe('buildClaudeInPlaceResumeCommand', () => {
  it('quotes POSIX vault paths without changing the resume command', () => {
    expect(
      buildClaudeInPlaceResumeCommand({
        configDir: "/vaults/O'Brien auth",
        resumeCommand: "claude --resume 'session-1' --dangerously-skip-permissions",
        shell: 'posix'
      })
    ).toBe(
      "export CLAUDE_CONFIG_DIR='/vaults/O'\\''Brien auth'; claude --resume 'session-1' --dangerously-skip-permissions"
    )
  })

  it('quotes PowerShell vault paths without interpolation', () => {
    expect(
      buildClaudeInPlaceResumeCommand({
        configDir: "C:\\Vaults\\O'Brien $auth",
        resumeCommand: "& 'claude' '--resume' 'session-1'",
        shell: 'powershell'
      })
    ).toBe(
      "$env:CLAUDE_CONFIG_DIR = 'C:\\Vaults\\O''Brien $auth'; & 'claude' '--resume' 'session-1'"
    )
  })

  it('escapes cmd metacharacters in vault paths', () => {
    expect(
      buildClaudeInPlaceResumeCommand({
        configDir: 'C:\\Vaults\\A&B%auth!',
        resumeCommand: '"claude" "--resume" "session-1"',
        shell: 'cmd'
      })
    ).toBe('set "CLAUDE_CONFIG_DIR=C:\\Vaults\\A^&B^%auth^!" & "claude" "--resume" "session-1"')
  })
})
