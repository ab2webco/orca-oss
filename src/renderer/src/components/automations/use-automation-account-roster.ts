import { useEffect, useState } from 'react'
import {
  listClaudeAccountsForEnvironment,
  listCodexAccountsForEnvironment
} from '@/runtime/runtime-provider-account-roster'
import { runtimeEnvironmentSupportsCapability } from '@/runtime/runtime-rpc-client'
import { AUTOMATION_ACCOUNT_PIN_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { filterClaudeAccountsByRuntime } from '@/lib/claude-account-runtime-filter'
import { filterCodexAccountsByRuntime } from '@/lib/codex-account-runtime-filter'

export type AutomationAccountProvider = 'claude' | 'codex'
export type AutomationAccountOption = { id: string; email: string }

export type AutomationAccountRoster = {
  status: 'loading' | 'ready' | 'error'
  accounts: AutomationAccountOption[]
  /** False when the owning runtime host predates `automation.account-pin.v1`. */
  hostSupportsPin: boolean
}

const LOADING: AutomationAccountRoster = { status: 'loading', accounts: [], hostSupportsPin: true }

async function loadRoster(
  provider: AutomationAccountProvider,
  environmentId: string | null,
  repoPath: string
): Promise<AutomationAccountRoster> {
  const hostSupportsPin = environmentId
    ? await runtimeEnvironmentSupportsCapability(
        environmentId,
        AUTOMATION_ACCOUNT_PIN_RUNTIME_CAPABILITY
      )
    : true
  const accounts =
    provider === 'claude'
      ? filterClaudeAccountsByRuntime(
          (await listClaudeAccountsForEnvironment(environmentId)).accounts,
          repoPath
        )
      : filterCodexAccountsByRuntime(
          (await listCodexAccountsForEnvironment(environmentId)).accounts,
          repoPath
        )
  return {
    status: 'ready',
    accounts: accounts.map(({ id, email }) => ({ id, email })),
    hostSupportsPin
  }
}

/** Reads the roster of the host the automation runs on; `enabled` false skips the fetch. */
export function useAutomationAccountRoster(
  provider: AutomationAccountProvider,
  environmentId: string | null,
  repoPath: string,
  enabled: boolean
): AutomationAccountRoster {
  const [roster, setRoster] = useState<AutomationAccountRoster>(LOADING)

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    setRoster(LOADING)
    void loadRoster(provider, environmentId, repoPath)
      .then((next) => {
        if (!cancelled) {
          setRoster(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRoster({ status: 'error', accounts: [], hostSupportsPin: true })
        }
      })
    return () => {
      cancelled = true
    }
  }, [enabled, provider, environmentId, repoPath])

  return roster
}
