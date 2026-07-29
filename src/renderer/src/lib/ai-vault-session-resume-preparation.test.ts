import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../shared/ai-vault-types'
import {
  claudeResumeLaunchAccountFromUniverse,
  prepareAiVaultSessionForResume
} from './ai-vault-session-resume-preparation'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prepareAiVaultSessionForResume', () => {
  it('returns a real-home launch identity only after targeted materialization succeeds', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({ useRealCodexHome: true })
    stubPreparation(prepareSessionResume)
    const legacy = session({
      codexHome: '/Users/ada/Library/Application Support/orca/codex-runtime-home/home'
    })

    const prepared = await prepareAiVaultSessionForResume(legacy)

    expect(prepared.session.codexHome).toBeNull()
    expect(prepareSessionResume).toHaveBeenCalledWith({
      agent: 'codex',
      filePath: legacy.filePath,
      codexHome: legacy.codexHome,
      executionHostId: 'local'
    })
  })

  it('rejects without changing the launch identity when materialization fails', async () => {
    stubPreparation(vi.fn().mockRejectedValue(new Error('Retry resume.')))

    await expect(
      prepareAiVaultSessionForResume(session({ codexHome: '/tmp/orca/codex-runtime-home/home' }))
    ).rejects.toThrow('Retry resume.')
  })

  it.each(['/custom/codex', '/tmp/orca/codex-accounts/account-1/home'])(
    'preserves a non-legacy home without materialization: %s',
    async (codexHome) => {
      const prepareSessionResume = vi.fn()
      stubPreparation(prepareSessionResume)
      const current = session({ codexHome })

      await expect(prepareAiVaultSessionForResume(current)).resolves.toEqual({ session: current })
      expect(prepareSessionResume).not.toHaveBeenCalled()
    }
  )

  it('resolves the owning Claude universe for a local Claude session', async () => {
    const prepareSessionResume = vi.fn().mockResolvedValue({
      useRealCodexHome: false,
      claudeUniverse: { kind: 'managed-account', accountId: 'account-1' }
    })
    stubPreparation(prepareSessionResume)
    const claude = session({
      agent: 'claude',
      filePath:
        '/Users/ada/Library/Application Support/orca/claude-accounts/account-1/auth/projects/-repo/session-1.jsonl'
    })

    const prepared = await prepareAiVaultSessionForResume(claude)

    expect(prepared.session).toBe(claude)
    expect(prepared.claudeUniverse).toEqual({ kind: 'managed-account', accountId: 'account-1' })
    expect(prepareSessionResume).toHaveBeenCalledWith({
      agent: 'claude',
      filePath: claude.filePath,
      codexHome: null,
      executionHostId: 'local'
    })
  })

  it('leaves the universe unresolved when preparation reports none', async () => {
    stubPreparation(vi.fn().mockResolvedValue({ useRealCodexHome: false }))
    const claude = session({ agent: 'claude', filePath: '/tmp/rollout.jsonl' })

    const prepared = await prepareAiVaultSessionForResume(claude)

    expect(prepared.session).toBe(claude)
    expect(prepared.claudeUniverse).toBeUndefined()
  })

  it.each(['ssh:conn-1', 'runtime:env-1'] as const)(
    'skips universe resolution for a Claude session owned by another host: %s',
    async (executionHostId) => {
      const prepareSessionResume = vi.fn()
      stubPreparation(prepareSessionResume)
      const claude = session({ agent: 'claude', executionHostId })

      await expect(prepareAiVaultSessionForResume(claude)).resolves.toEqual({ session: claude })
      expect(prepareSessionResume).not.toHaveBeenCalled()
    }
  )
})

describe('claudeResumeLaunchAccountFromUniverse', () => {
  it('pins the launch to the owning managed account', () => {
    expect(
      claudeResumeLaunchAccountFromUniverse({ kind: 'managed-account', accountId: 'account-1' })
    ).toEqual({ claudeAccountId: 'account-1' })
  })

  it('forces the shared home for a shared-home transcript', () => {
    expect(claudeResumeLaunchAccountFromUniverse({ kind: 'shared-home' })).toEqual({
      claudeAccountId: null
    })
  })

  it('leaves the launch untouched without a universe verdict', () => {
    expect(claudeResumeLaunchAccountFromUniverse(undefined)).toEqual({})
  })

  it('fails with a clear message when the owning account was removed', () => {
    expect(() =>
      claudeResumeLaunchAccountFromUniverse({ kind: 'missing-account', accountId: 'account-1' })
    ).toThrow(/removed/i)
  })
})

function stubPreparation(prepareSessionResume: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('window', { api: { aiVault: { prepareSessionResume } } })
}

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'local:codex:session-1:/tmp/rollout.jsonl',
    executionHostId: 'local',
    agent: 'codex',
    sessionId: 'session-1',
    title: 'Legacy session',
    cwd: '/repo',
    branch: null,
    model: null,
    filePath: '/tmp/rollout.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-07-20T00:00:00.000Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: "codex resume 'session-1'",
    subagent: null,
    ...overrides
  }
}
