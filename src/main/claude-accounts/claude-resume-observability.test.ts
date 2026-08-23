import { describe, expect, it } from 'vitest'
import { wrapRuntimeHomeHookCommand } from '../agent-hooks/runtime-home-hook-command'
import { getWindowsManagedLifecycleHook } from '../claude/hook-settings'
import { settingsReportResumedClaudeSession } from './claude-resume-observability'

const SCRIPT_FILE_NAME = 'claude-hook.cmd'

function settingsWithSessionStart(hook: Record<string, unknown>): string {
  return JSON.stringify({ hooks: { SessionStart: [{ matcher: 'resume', hooks: [hook] }] } })
}

describe('settingsReportResumedClaudeSession', () => {
  // Why both shapes: getManagedLifecycleHook emits the exec form on Windows and the
  // shell form everywhere else, and this reader runs against whatever is on disk.
  it('recognizes the Windows exec form, whose script lives in args', () => {
    const hook = getWindowsManagedLifecycleHook(
      'C:\\Users\\dev\\.orca\\agent-hooks\\claude-hook.cmd'
    )

    expect(hook.command).toMatch(/conhost\.exe$/i)
    expect(hook.command).not.toContain('agent-hooks')
    expect(
      settingsReportResumedClaudeSession(
        settingsWithSessionStart(hook as unknown as Record<string, unknown>),
        SCRIPT_FILE_NAME
      )
    ).toBe(true)
  })

  it('recognizes the POSIX shell form', () => {
    const hook = { type: 'command', command: wrapRuntimeHomeHookCommand('claude-hook') }

    expect(
      settingsReportResumedClaudeSession(settingsWithSessionStart(hook), SCRIPT_FILE_NAME)
    ).toBe(true)
  })

  it('recognizes the PowerShell -EncodedCommand branch the shell form falls back to', () => {
    const encoded = wrapRuntimeHomeHookCommand('claude-hook').match(/-EncodedCommand (\S+)/)?.[1]
    expect(encoded).toBeDefined()
    // Only the encoded payload names the script, so a matcher that skips base64 misses this.
    expect(Buffer.from(encoded!, 'base64').toString('utf16le')).toContain('claude-hook.cmd')

    const hook = {
      type: 'command',
      command: '"$SYSTEMROOT/System32/WindowsPowerShell/v1.0/powershell.exe"',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded!]
    }

    expect(
      settingsReportResumedClaudeSession(settingsWithSessionStart(hook), SCRIPT_FILE_NAME)
    ).toBe(true)
  })

  // The other direction: without these, a matcher that answered true for everything would pass.
  it('rejects a hook that is not ours, in command or in args', () => {
    const foreignShell = { type: 'command', command: '/usr/local/bin/my-own-hook.sh' }
    const foreignExec = {
      type: 'command',
      command: 'C:\\Windows\\System32\\conhost.exe',
      args: [
        '--headless',
        'C:\\Windows\\System32\\cmd.exe',
        '/d',
        '/c',
        '%USERPROFILE%\\hooks\\theirs.cmd'
      ]
    }
    const otherAgent = { type: 'command', command: wrapRuntimeHomeHookCommand('codex-hook') }

    for (const hook of [foreignShell, foreignExec, otherAgent]) {
      expect(
        settingsReportResumedClaudeSession(settingsWithSessionStart(hook), SCRIPT_FILE_NAME)
      ).toBe(false)
    }
  })

  it('reports no session when SessionStart is absent, malformed or unparseable', () => {
    expect(settingsReportResumedClaudeSession(null, SCRIPT_FILE_NAME)).toBe(false)
    expect(settingsReportResumedClaudeSession('{ not json', SCRIPT_FILE_NAME)).toBe(false)
    expect(settingsReportResumedClaudeSession('{"hooks":{}}', SCRIPT_FILE_NAME)).toBe(false)
    expect(
      settingsReportResumedClaudeSession(
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'x' }] }] } }),
        SCRIPT_FILE_NAME
      )
    ).toBe(false)
  })
})
