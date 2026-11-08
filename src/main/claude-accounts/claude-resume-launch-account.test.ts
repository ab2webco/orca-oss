import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_RESUME_SESSION_MISSING_MESSAGE,
  resolveClaudeLaunchAccountForSpawn
} from './claude-resume-launch-account'
import type { ClaudeResumeSessionLocation } from './claude-resume-session-location'

const managedTranscript =
  '/Users/me/Library/Application Support/orca/claude-accounts/acct-lead/auth/projects/-repo/abc.jsonl'
const sharedTranscript = '/Users/me/.claude/projects/-repo/abc.jsonl'
const storeTranscript =
  '/Users/me/Library/Application Support/orca/claude-transcripts/projects/-repo/abc.jsonl'

const resume = (transcriptPath?: string) => ({
  key: 'session_id' as const,
  id: 'abc',
  ...(transcriptPath ? { transcriptPath } : {})
})

const located = (location: ClaudeResumeSessionLocation) => vi.fn(async () => location)

describe('resolveClaudeLaunchAccountForSpawn', () => {
  it('keeps an explicit launch account over everything', () => {
    const locateSession = located({ kind: 'missing' })

    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: 'acct-explicit',
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: () => false,
        locateSession
      })
    ).toBe('acct-explicit')
    expect(locateSession).not.toHaveBeenCalled()
  })

  it('resumes on the account whose vault the transcript lives under, without waiting', () => {
    const locateSession = located({ kind: 'missing' })

    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: (id) => id === 'acct-lead',
        locateSession
      })
    ).toBe('acct-lead')
    expect(locateSession).not.toHaveBeenCalled()
  })

  it('leaves a fresh launch alone and never looks anything up', () => {
    const locateSession = located({ kind: 'missing' })

    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: undefined,
        hasManagedAccount: () => true,
        locateSession
      })
    ).toBeUndefined()
    expect(locateSession).not.toHaveBeenCalled()
  })

  // ORCA-718: every linked universe reads one shared transcript store, so a conversation there
  // resumes on what a new launch in its worktree would get.
  describe('a resume no existing vault account owns', () => {
    for (const [label, session, hasManagedAccount] of [
      ['an account that was removed', resume(managedTranscript), () => false],
      ['a conversation kept in ~/.claude', resume(sharedTranscript), () => true],
      ['a path inside the shared store', resume(storeTranscript), () => true],
      ['no transcript path', resume(), () => true]
    ] as const) {
      it(`uses the worktree pin or selected account for ${label} when any account can read it`, async () => {
        const locateSession = located({ kind: 'shared' })

        await expect(
          resolveClaudeLaunchAccountForSpawn({
            launchAccountId: undefined,
            resumeProviderSession: session,
            hasManagedAccount,
            locateSession
          })
        ).resolves.toBeUndefined()
        expect(locateSession).toHaveBeenCalledWith(session)
      })
    }

    // Why: a universe whose link was skipped keeps a projects/ no other account can read.
    it('runs on the unlinked vault that alone holds the conversation', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(),
          hasManagedAccount: () => true,
          locateSession: located({ kind: 'universe', accountId: 'acct-unlinked' })
        })
      ).resolves.toBe('acct-unlinked')
    })

    it('forces the shared home when only the unlinked shared home holds the conversation', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(sharedTranscript),
          hasManagedAccount: () => true,
          locateSession: located({ kind: 'universe', accountId: null })
        })
      ).resolves.toBeNull()
    })

    it('refuses only when no account can read the conversation', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(managedTranscript),
          hasManagedAccount: () => false,
          locateSession: located({ kind: 'missing' })
        })
      ).rejects.toThrow(CLAUDE_RESUME_SESSION_MISSING_MESSAGE)
    })

    it('keeps the new-launch account where the conversation cannot be located, as on a WSL spawn', () => {
      expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(managedTranscript),
          hasManagedAccount: () => false
        })
      ).toBeUndefined()
    })
  })
})
