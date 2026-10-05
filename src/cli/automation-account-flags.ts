import { getPresentStringFlag } from './flags'
import { resolveAccountSelectorFlags } from './account-selector'
import type { RuntimeClient } from './runtime-client'

export const AUTOMATION_ACCOUNT_FLAGS = ['claude-account', 'codex-account'] as const

export type AutomationAccountPins = {
  claudeAccountId?: string | null
  codexAccountId?: string | null
}

// An empty value matches --target-pane; `inherit` is the spelled-out alias.
function isInheritValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return trimmed === '' || trimmed === 'inherit'
}

/** Resolves --claude-account / --codex-account (email or id) into pins; an
 *  inherit value yields null, an absent flag yields no key. */
export async function resolveAutomationAccountFlags(
  flags: Map<string, string | boolean>,
  client: RuntimeClient
): Promise<AutomationAccountPins> {
  const pins: AutomationAccountPins = {}
  const toResolve = new Map<string, string | boolean>()
  for (const flag of AUTOMATION_ACCOUNT_FLAGS) {
    const value = getPresentStringFlag(flags, flag, { allowEmpty: true })
    if (value === undefined) {
      continue
    }
    if (isInheritValue(value)) {
      pins[flag === 'claude-account' ? 'claudeAccountId' : 'codexAccountId'] = null
    } else {
      toResolve.set(flag, value)
    }
  }
  return { ...pins, ...(await resolveAccountSelectorFlags(toResolve, client)) }
}

export function hasAutomationAccountFlag(flags: Map<string, string | boolean>): boolean {
  return AUTOMATION_ACCOUNT_FLAGS.some((flag) => flags.has(flag))
}
