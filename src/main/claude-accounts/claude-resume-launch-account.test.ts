import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_RESUME_ACCOUNT_REMOVED_MESSAGE,
  claudeResumeAmbiguousMessage,
  CLAUDE_RESUME_SESSION_MISSING_MESSAGE,
  resolveClaudeLaunchAccountForSpawn
} from './claude-resume-launch-account'
import type { ClaudeSessionLookupResult } from './claude-resume-session-lookup'

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

const lookupReturning = (result: ClaudeSessionLookupResult) => vi.fn(async () => result)
const labelOf = (accountId: string | null) =>
  accountId === null ? 'the default login' : `${accountId}@example.com`

describe('resolveClaudeLaunchAccountForSpawn', () => {
  it('resumes a managed-account conversation on that account', async () => {
    expect(
      await resolveClaudeLaunchAccountForSpawn({
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

  // Why: an await on a plain value would cost every ordinary spawn a microtask.
  it('answers without a promise unless it has to look the session up', () => {
    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: () => true,
        findSessionUniverse: lookupReturning({ kind: 'missing' })
      })
    ).toBe('acct-lead')
  })

  it('forces the shared home for a conversation kept in ~/.claude', async () => {
    expect(
      await resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(sharedTranscript),
        hasManagedAccount: () => true
      })
    ).toBeNull()
  })

  it('keeps an explicit launch account over the transcript', async () => {
    expect(
      await resolveClaudeLaunchAccountForSpawn({
        launchAccountId: 'acct-explicit',
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: () => false
      })
    ).toBe('acct-explicit')
  })

  it('leaves a fresh launch alone and never looks anything up', async () => {
    const findSessionUniverse = lookupReturning({ kind: 'missing' })

    expect(
      await resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: undefined,
        hasManagedAccount: () => true,
        findSessionUniverse
      })
    ).toBeUndefined()
    expect(findSessionUniverse).not.toHaveBeenCalled()
  })

  // ORCA-718: records kept before transcript paths were stored still fell to the global login.
  describe('a resume with no transcript verdict', () => {
    for (const [label, session] of [
      ['no transcript path', resume()],
      ['a path that is not a transcript', resume('/tmp/not-a-transcript.jsonl')],
      ['a path in the shared transcript store, which every universe links', resume(storeTranscript)]
    ] as const) {
      it(`looks the session up for ${label}`, async () => {
        const findSessionUniverse = lookupReturning({ kind: 'found', accountId: 'acct-lead' })

        expect(
          await resolveClaudeLaunchAccountForSpawn({
            launchAccountId: undefined,
            resumeProviderSession: session,
            hasManagedAccount: () => true,
            findSessionUniverse
          })
        ).toBe('acct-lead')
        expect(findSessionUniverse).toHaveBeenCalledWith('abc')
      })
    }

    it('runs on the shared home when only the shared home holds it', async () => {
      expect(
        await resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(),
          hasManagedAccount: () => true,
          findSessionUniverse: lookupReturning({ kind: 'found', accountId: null })
        })
      ).toBeNull()
    })

    it('refuses with a message when no account holds it', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(),
          hasManagedAccount: () => true,
          findSessionUniverse: lookupReturning({ kind: 'missing' })
        })
      ).rejects.toThrow(CLAUDE_RESUME_SESSION_MISSING_MESSAGE)
    })

    it('refuses with the candidates when more than one account holds it', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(),
          hasManagedAccount: () => true,
          findSessionUniverse: lookupReturning({
            kind: 'ambiguous',
            accountIds: [null, 'acct-a']
          }),
          labelOf
        })
      ).rejects.toThrow(claudeResumeAmbiguousMessage(['the default login', 'acct-a@example.com']))
    })

    it('keeps the old fallback where no lookup is available, as on a WSL or SSH spawn', async () => {
      expect(
        await resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(),
          hasManagedAccount: () => true
        })
      ).toBeUndefined()
    })
  })
})
