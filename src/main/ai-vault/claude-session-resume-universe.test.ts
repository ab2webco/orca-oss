import { describe, expect, it, vi } from 'vitest'
import {
  resolveClaudeResumeUniverse,
  withClaudeResumeUniverse
} from './claude-session-resume-universe'
import type { AiVaultPrepareSessionResumeArgs } from '../../shared/ai-vault-resume-preparation'

const VAULT_TRANSCRIPT =
  '/Users/ada/Library/Application Support/orca/claude-accounts/account-1/auth/projects/-repo/session-1.jsonl'
const SHARED_TRANSCRIPT = '/Users/ada/.claude/projects/-repo/session-1.jsonl'

function args(
  overrides: Partial<AiVaultPrepareSessionResumeArgs> = {}
): AiVaultPrepareSessionResumeArgs {
  return {
    agent: 'claude',
    filePath: VAULT_TRANSCRIPT,
    codexHome: null,
    executionHostId: 'local',
    ...overrides
  }
}

const accountExists = { hasClaudeManagedAccount: () => true }
const accountMissing = { hasClaudeManagedAccount: () => false }

describe('resolveClaudeResumeUniverse', () => {
  it('resolves a managed-vault transcript to its owning account', () => {
    expect(resolveClaudeResumeUniverse(args(), accountExists)).toEqual({
      kind: 'managed-account',
      accountId: 'account-1'
    })
  })

  it('reports a missing account instead of an owning account that no longer exists', () => {
    expect(resolveClaudeResumeUniverse(args(), accountMissing)).toEqual({
      kind: 'missing-account',
      accountId: 'account-1'
    })
  })

  it('resolves a shared-home transcript to the shared universe', () => {
    expect(
      resolveClaudeResumeUniverse(args({ filePath: SHARED_TRANSCRIPT }), accountExists)
    ).toEqual({ kind: 'shared-home' })
  })

  it('yields no verdict for a path outside the Claude transcript layout', () => {
    expect(
      resolveClaudeResumeUniverse(args({ filePath: '/tmp/rollout.jsonl' }), accountExists)
    ).toBeUndefined()
  })

  it('yields no verdict for non-Claude agents', () => {
    expect(resolveClaudeResumeUniverse(args({ agent: 'codex' }), accountExists)).toBeUndefined()
  })

  it.each(['ssh:conn-1', 'runtime:env-1'] as const)(
    'yields no verdict for a transcript owned by another host: %s',
    (executionHostId) => {
      expect(resolveClaudeResumeUniverse(args({ executionHostId }), accountExists)).toBeUndefined()
    }
  )
})

describe('withClaudeResumeUniverse', () => {
  it('attaches the resolved universe to the base preparation result', async () => {
    const base = vi.fn().mockResolvedValue({ useRealCodexHome: false })
    const prepare = withClaudeResumeUniverse(base, accountExists)

    await expect(prepare(args())).resolves.toEqual({
      useRealCodexHome: false,
      claudeUniverse: { kind: 'managed-account', accountId: 'account-1' }
    })
    expect(base).toHaveBeenCalledWith(args())
  })

  it('returns the base result untouched when no universe can be resolved', async () => {
    const base = vi.fn().mockResolvedValue({ useRealCodexHome: true })
    const prepare = withClaudeResumeUniverse(base, accountExists)

    await expect(prepare(args({ agent: 'codex' }))).resolves.toEqual({ useRealCodexHome: true })
  })
})
