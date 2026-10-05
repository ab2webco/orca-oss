import type { Automation } from './automations-types'

/** Managed accounts an automation run launches with; an absent key inherits the host selection. */
export type AutomationLaunchAccounts = {
  claudeAccountId?: string
  codexAccountId?: string
}

type AutomationLaunchAccountFields = Pick<
  Automation,
  'agentId' | 'command' | 'claudeAccountId' | 'codexAccountId'
>

// Why only the matching pin: a Codex run must not inherit the Claude pin and vice versa.
export function automationLaunchAccounts(
  automation: Partial<AutomationLaunchAccountFields>
): AutomationLaunchAccounts {
  if (automation.command) {
    return {}
  }
  if (automation.agentId === 'claude' && automation.claudeAccountId) {
    return { claudeAccountId: automation.claudeAccountId }
  }
  if (automation.agentId === 'codex' && automation.codexAccountId) {
    return { codexAccountId: automation.codexAccountId }
  }
  return {}
}
