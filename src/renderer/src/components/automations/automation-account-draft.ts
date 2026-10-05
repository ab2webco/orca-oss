import type { Automation } from '../../../../shared/automations-types'
import type { AutomationDraft } from './AutomationEditorDialog'

type AccountDraftFields = Pick<AutomationDraft, 'claudeAccountId' | 'codexAccountId'>

export function accountDraftFromAutomation(
  automation: Pick<Automation, 'claudeAccountId' | 'codexAccountId'>
): AccountDraftFields {
  return {
    claudeAccountId: automation.claudeAccountId ?? null,
    codexAccountId: automation.codexAccountId ?? null
  }
}

type AccountSaveFields = { claudeAccountId?: string | null; codexAccountId?: string | null }

export function automationAccountSaveFields(
  draft: Pick<AutomationDraft, 'actionKind'> & AccountDraftFields,
  mode: 'create' | 'update'
): AccountSaveFields {
  // A command-only run launches no agent, so it keeps no pin.
  const claudeAccountId = draft.actionKind === 'command' ? null : draft.claudeAccountId
  const codexAccountId = draft.actionKind === 'command' ? null : draft.codexAccountId
  if (mode === 'update') {
    return { claudeAccountId, codexAccountId }
  }
  // Create omits inherit so an older host receives the payload it already knows.
  return {
    ...(claudeAccountId ? { claudeAccountId } : {}),
    ...(codexAccountId ? { codexAccountId } : {})
  }
}
