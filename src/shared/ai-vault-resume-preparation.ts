import type { AiVaultSession } from './ai-vault-types'

export type AiVaultPrepareSessionResumeArgs = Pick<
  AiVaultSession,
  'agent' | 'filePath' | 'codexHome' | 'executionHostId'
>

/** Which Claude universe owns a transcript being resumed, resolved from the
 *  transcript's own path by the host that owns the file. A launch that targets
 *  any other universe gets "No conversation found with session ID". */
export type AiVaultClaudeResumeUniverse =
  | { kind: 'managed-account'; accountId: string }
  /** The owning managed account no longer exists in settings; the resume must
   *  fail with a clear message instead of launching against another universe. */
  | { kind: 'missing-account'; accountId: string }
  | { kind: 'shared-home' }

export type AiVaultPrepareSessionResumeResult = {
  useRealCodexHome: boolean
  /** Absent for non-Claude agents, non-local hosts, and unrecognized layouts —
   *  the launch then keeps its default account resolution (fail-safe). */
  claudeUniverse?: AiVaultClaudeResumeUniverse
  // Why: cross-account hardlinking lists one rollout under several per-account
  // homes, so the owning host repins resume to the selected account's home.
  // Absent (older hosts included) means resume keeps the session's own home.
  substituteCodexHome?: string
}

export type AiVaultSessionResumePreparation = (
  args: AiVaultPrepareSessionResumeArgs
) => Promise<AiVaultPrepareSessionResumeResult>

const LEGACY_MOBILE_PREPARATION_FORBIDDEN_MESSAGE =
  "Method 'aiVault.prepareSessionResume' is not available to mobile clients"

export function isAiVaultPrepareSessionResumeUnavailableError(error: {
  code: string
  message: string
}): boolean {
  return (
    error.code === 'method_not_found' ||
    (error.code === 'forbidden' && error.message === LEGACY_MOBILE_PREPARATION_FORBIDDEN_MESSAGE)
  )
}

export function isLegacySharedCodexHome(codexHome: string | null): boolean {
  if (!codexHome) {
    return false
  }
  const segments = codexHome.split(/[\\/]/).filter(Boolean)
  return segments.at(-2) === 'codex-runtime-home' && segments.at(-1) === 'home'
}

/** Matches the managed `codex-accounts/<id>/home` layout, mirroring the AI Vault scan-root shape check. */
export function isPerAccountManagedCodexHome(codexHome: string | null): boolean {
  if (!codexHome) {
    return false
  }
  const segments = codexHome.split(/[\\/]/).filter(Boolean)
  return segments.at(-3) === 'codex-accounts' && segments.at(-1) === 'home'
}
