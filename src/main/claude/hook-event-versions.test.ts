import { describe, expect, it } from 'vitest'
import { CLAUDE_EVENTS } from './hook-settings'
import {
  detectClaudeCodeVersion,
  parseClaudeCodeVersion,
  selectClaudeEventsForVersion,
  UNKNOWN_VERSION_EVENT_FLOOR
} from './hook-event-versions'

const names = (events: readonly { eventName: string }[]): string[] =>
  events.map((event) => event.eventName)

describe('parseClaudeCodeVersion', () => {
  it('parses the leading semver from `claude --version` output', () => {
    expect(parseClaudeCodeVersion('2.1.218 (Claude Code)')).toBe('2.1.218')
    expect(parseClaudeCodeVersion('1.0.38\n')).toBe('1.0.38')
  })

  it('returns null when no semver is present', () => {
    expect(parseClaudeCodeVersion('not a version')).toBeNull()
    expect(parseClaudeCodeVersion('')).toBeNull()
  })
})

describe('selectClaudeEventsForVersion', () => {
  const BASE_EVENTS = ['UserPromptSubmit', 'Stop', 'SubagentStop', 'PreToolUse', 'PostToolUse']

  it('includes only base events on the unknown-version floor', () => {
    expect(names(selectClaudeEventsForVersion(UNKNOWN_VERSION_EVENT_FLOOR)).sort()).toEqual(
      [...BASE_EVENTS].sort()
    )
  })

  it('falls back to the base set when the version is null', () => {
    expect(names(selectClaudeEventsForVersion(null)).sort()).toEqual([...BASE_EVENTS].sort())
  })

  it('includes every event for a recent version', () => {
    expect(names(selectClaudeEventsForVersion('2.1.218')).sort()).toEqual(
      names(CLAUDE_EVENTS).sort()
    )
  })

  it('gates a mid-range version to the events it recognizes', () => {
    const selected = names(selectClaudeEventsForVersion('2.0.45'))
    // 2.0.45 introduced PermissionRequest but predates TeammateIdle (2.1.33).
    expect(selected).toContain('PermissionRequest')
    expect(selected).toContain('SubagentStart')
    expect(selected).not.toContain('TeammateIdle')
    expect(selected).not.toContain('StopFailure')
  })
})

describe('detectClaudeCodeVersion', () => {
  it('returns null when the binary cannot be spawned', () => {
    expect(detectClaudeCodeVersion(() => '/nonexistent/orca-test-claude-binary')).toBeNull()
  })
})
