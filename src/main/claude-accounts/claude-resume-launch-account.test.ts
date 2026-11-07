import { describe, expect, it } from 'vitest'
import {
  CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE,
  resolveClaudeLaunchAccountForSpawn
} from './claude-resume-launch-account'

const managedTranscript =
  '/Users/me/Library/Application Support/orca/claude-accounts/acct-lead/auth/projects/-repo/abc.jsonl'
const sharedTranscript = '/Users/me/.claude/projects/-repo/abc.jsonl'

const resume = (transcriptPath?: string) => ({
  key: 'session_id' as const,
  id: 'abc',
  ...(transcriptPath ? { transcriptPath } : {})
})

describe('resolveClaudeLaunchAccountForSpawn', () => {
  it('resumes a managed-account conversation on that account', () => {
    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: (id) => id === 'acct-lead'
      })
    ).toBe('acct-lead')
  })

  it('refuses instead of falling to the global login when the owning account was removed', () => {
    expect(() =>
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: () => false
      })
    ).toThrow(CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE)
  })

  it('forces the shared home for a conversation kept in ~/.claude', () => {
    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(sharedTranscript),
        hasManagedAccount: () => true
      })
    ).toBeNull()
  })

  it('keeps an explicit launch account over the transcript', () => {
    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: 'acct-explicit',
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: () => false
      })
    ).toBe('acct-explicit')
  })

  it('leaves the pin and global selection alone without a transcript verdict', () => {
    for (const session of [undefined, resume(), resume('/tmp/not-a-transcript.jsonl')]) {
      expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: session,
          hasManagedAccount: () => true
        })
      ).toBeUndefined()
    }
  })
})
