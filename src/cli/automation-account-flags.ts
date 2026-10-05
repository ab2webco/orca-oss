import { getPresentStringFlag } from './flags'
import { resolveAccountSelectorFlags } from './account-selector'
import { RuntimeClientError, type RuntimeClient } from './runtime-client'
import { AUTOMATION_ACCOUNT_PIN_RUNTIME_CAPABILITY } from '../shared/protocol-version'
import type { RuntimeStatus } from '../shared/runtime-types'

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
  if (!hasAutomationAccountFlag(flags)) {
    return {}
  }
  await assertAutomationAccountPinSupported(client)
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

// Why: an older runtime strips the pin fields and still answers ok.
async function assertAutomationAccountPinSupported(client: RuntimeClient): Promise<void> {
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(AUTOMATION_ACCOUNT_PIN_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The connected Orca Lab runtime does not support account pins on automations. Update or restart Orca Lab and try again.'
    )
  }
}
