import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_RESUME_SESSION_MISSING_MESSAGE,
  resolveClaudeLaunchAccountForSpawn
} from './claude-resume-launch-account'
import type { SharedStoreSessionVerdict } from './claude-shared-store-session'

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

const storeSays = (verdict: SharedStoreSessionVerdict) => vi.fn(async () => verdict)

describe('resolveClaudeLaunchAccountForSpawn', () => {
  it('keeps an explicit launch account over everything', () => {
    const findInSharedStore = storeSays('missing')

    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: 'acct-explicit',
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: () => false,
        findInSharedStore
      })
    ).toBe('acct-explicit')
    expect(findInSharedStore).not.toHaveBeenCalled()
  })

  it('resumes on the account whose vault the transcript lives under, without waiting', () => {
    const findInSharedStore = storeSays('missing')

    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: resume(managedTranscript),
        hasManagedAccount: (id) => id === 'acct-lead',
        findInSharedStore
      })
    ).toBe('acct-lead')
    expect(findInSharedStore).not.toHaveBeenCalled()
  })

  it('leaves a fresh launch alone and never checks the store', () => {
    const findInSharedStore = storeSays('missing')

    expect(
      resolveClaudeLaunchAccountForSpawn({
        launchAccountId: undefined,
        resumeProviderSession: undefined,
        hasManagedAccount: () => true,
        findInSharedStore
      })
    ).toBeUndefined()
    expect(findInSharedStore).not.toHaveBeenCalled()
  })

  // ORCA-718: every universe links projects/ to one shared store, so any account can resume any
  // conversation in it; the pane takes what a new launch in its worktree would get.
  describe('a resume no existing vault account owns', () => {
    for (const [label, session, hasManagedAccount] of [
      ['an account that was removed', resume(managedTranscript), () => false],
      ['a conversation kept in ~/.claude', resume(sharedTranscript), () => true],
      ['a path inside the shared store', resume(storeTranscript), () => true],
      ['no transcript path', resume(), () => true]
    ] as const) {
      it(`uses the worktree pin or selected account for ${label} when the store holds it`, async () => {
        const findInSharedStore = storeSays('found')

        await expect(
          resolveClaudeLaunchAccountForSpawn({
            launchAccountId: undefined,
            resumeProviderSession: session,
            hasManagedAccount,
            findInSharedStore
          })
        ).resolves.toBeUndefined()
        expect(findInSharedStore).toHaveBeenCalledWith(session)
      })
    }

    it('refuses only when the store does not hold the conversation, since nothing can resume it', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(managedTranscript),
          hasManagedAccount: () => false,
          findInSharedStore: storeSays('missing')
        })
      ).rejects.toThrow(CLAUDE_RESUME_SESSION_MISSING_MESSAGE)
    })

    it('does not refuse on a host with no shared store, whose universes keep their own transcripts', async () => {
      await expect(
        resolveClaudeLaunchAccountForSpawn({
          launchAccountId: undefined,
          resumeProviderSession: resume(),
          hasManagedAccount: () => true,
          findInSharedStore: storeSays('no-store')
        })
      ).resolves.toBeUndefined()
    })

    it('keeps the new-launch account where the store cannot be checked, as on a WSL spawn', () => {
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
