import { describe, expect, it } from 'vitest'
import {
  resolveClaudeResumeAccountId,
  resolveClaudeTranscriptUniverse
} from './claude-transcript-universe'

describe('resolveClaudeTranscriptUniverse', () => {
  it('reads the account id out of a managed vault path', () => {
    // The real shape from the reporting machine.
    expect(
      resolveClaudeTranscriptUniverse(
        '/Users/dev/Library/Application Support/orca/claude-accounts/1cc3ebaa-36c7/auth/projects/-Users-dev-repo/97e0be8e.jsonl'
      )
    ).toEqual({ kind: 'managed-account', accountId: '1cc3ebaa-36c7' })
  })

  it('reads a Windows vault path', () => {
    expect(
      resolveClaudeTranscriptUniverse(
        'C:\\Users\\dev\\AppData\\Roaming\\orca\\claude-accounts\\acct-1\\auth\\projects\\-C--repo\\s.jsonl'
      )
    ).toEqual({ kind: 'managed-account', accountId: 'acct-1' })
  })

  it('treats the user home as the shared universe', () => {
    expect(
      resolveClaudeTranscriptUniverse('/Users/dev/.claude/projects/-Users-dev-repo/97e0be8e.jsonl')
    ).toEqual({ kind: 'shared-home' })
  })

  it('reads the universe of a sidechain transcript nested under its session', () => {
    // Why: subagent transcripts sit one level deeper; the universe is still the
    // nearest enclosing projects/ root, not the session directory.
    expect(
      resolveClaudeTranscriptUniverse(
        '/data/orca/claude-accounts/acct-1/auth/projects/-repo/session/subagents/a.jsonl'
      )
    ).toEqual({ kind: 'managed-account', accountId: 'acct-1' })
  })

  it('does not guess when the path is not a Claude transcript layout', () => {
    expect(resolveClaudeTranscriptUniverse('/data/rollouts/2026/session.jsonl')).toEqual({
      kind: 'unknown'
    })
    expect(resolveClaudeTranscriptUniverse('')).toEqual({ kind: 'unknown' })
  })

  it('does not mistake a project directory literally named projects', () => {
    // `projects` as the FIRST segment has no parent to classify, so guessing a
    // universe from it would pin a launch on nothing.
    expect(resolveClaudeTranscriptUniverse('projects/-repo/session.jsonl')).toEqual({
      kind: 'unknown'
    })
  })
})

describe('resolveClaudeResumeAccountId', () => {
  it('returns the owning account for a vault transcript', () => {
    expect(
      resolveClaudeResumeAccountId('/data/orca/claude-accounts/acct-9/auth/projects/-r/s.jsonl')
    ).toBe('acct-9')
  })

  it('returns null for the shared home and for anything unrecognized', () => {
    expect(resolveClaudeResumeAccountId('/Users/dev/.claude/projects/-r/s.jsonl')).toBeNull()
    // Why null and not a throw: the caller keeps the worktree's own pin rather
    // than redirecting a launch it cannot justify.
    expect(resolveClaudeResumeAccountId('/somewhere/else/s.jsonl')).toBeNull()
  })
})
