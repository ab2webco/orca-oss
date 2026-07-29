import type { AiVaultSession } from '../../../shared/ai-vault-types'
import {
  isLegacySharedCodexHome,
  type AiVaultClaudeResumeUniverse
} from '../../../shared/ai-vault-resume-preparation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { translate } from '@/i18n/i18n'

export type PreparedAiVaultSessionResume = {
  session: AiVaultSession
  /** Which Claude universe owns the transcript; absent when the host gave no
   *  verdict (non-Claude, non-local, or unrecognized layout) — fail-safe. */
  claudeUniverse?: AiVaultClaudeResumeUniverse
}

export async function prepareAiVaultSessionForResume(
  session: AiVaultSession
): Promise<PreparedAiVaultSessionResume> {
  // Why the host gate: only this host's accounts can satisfy an override, and
  // remote (runtime/SSH) launches cannot apply one — skipping the round-trip
  // also keeps remote resumes off a preparation path they cannot benefit from.
  if (session.agent === 'claude' && session.executionHostId === LOCAL_EXECUTION_HOST_ID) {
    const result = await window.api.aiVault.prepareSessionResume({
      agent: session.agent,
      filePath: session.filePath,
      codexHome: session.codexHome,
      executionHostId: session.executionHostId
    })
    return result.claudeUniverse ? { session, claudeUniverse: result.claudeUniverse } : { session }
  }
  if (session.agent !== 'codex' || !isLegacySharedCodexHome(session.codexHome)) {
    return { session }
  }
  const result = await window.api.aiVault.prepareSessionResume({
    agent: session.agent,
    filePath: session.filePath,
    codexHome: session.codexHome,
    executionHostId: session.executionHostId
  })
  return { session: result.useRealCodexHome ? { ...session, codexHome: null } : session }
}

/**
 * Maps a universe verdict to the launch-scoped account override, ready to
 * spread into `launchAiVaultSessionInNewTab`. Throws the user-facing message
 * when the owning account was removed — launching against another universe
 * would only produce "No conversation found with session ID".
 */
export function claudeResumeLaunchAccountFromUniverse(
  universe: AiVaultClaudeResumeUniverse | undefined
): { claudeAccountId?: string | null } {
  if (!universe) {
    return {}
  }
  switch (universe.kind) {
    case 'managed-account':
      return { claudeAccountId: universe.accountId }
    case 'shared-home':
      return { claudeAccountId: null }
    case 'missing-account':
      throw new Error(
        translate(
          'auto.lib.ai.vault.session.resume.preparation.owningAccountRemoved',
          'The Claude account that owns this session was removed. Add that account again in Settings to resume it.'
        )
      )
  }
}
