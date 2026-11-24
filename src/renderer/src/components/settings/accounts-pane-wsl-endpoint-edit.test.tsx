// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { AccountsPane } from './AccountsPane'

const beginHostAccountLogin = vi.fn()
const supportsCapability = vi.fn()

vi.mock('@/runtime/runtime-host-login-client', () => ({
  beginHostAccountLogin: (...args: unknown[]) => beginHostAccountLogin(...args),
  completeHostAccountLogin: vi.fn().mockResolvedValue({}),
  cancelHostAccountLogin: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runtimeEnvironmentSupportsCapability: (environmentId: string, capability: string) =>
    supportsCapability(environmentId, capability)
}))

const endpointAccount = (id: string, label: string, wslDistro: string | null) => ({
  id,
  email: label,
  managedAuthPath: `/srv/${id}`,
  managedAuthRuntime: wslDistro ? ('wsl' as const) : ('host' as const),
  wslDistro,
  wslLinuxAuthPath: null,
  authMethod: 'custom-endpoint' as const,
  endpointLabel: label,
  endpointBaseUrl: 'https://api.z.ai/api/anthropic',
  endpointModel: 'glm-5.1',
  organizationUuid: null,
  organizationName: null,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
})

const claudeState = {
  accounts: [endpointAccount('wsl-glm', 'WSL GLM', 'Ubuntu-24.04')],
  activeAccountId: null,
  activeAccountIdsByRuntime: { host: null, wsl: {} },
  rateLimits: {}
}
const codexState = {
  accounts: [],
  activeAccountId: null,
  activeAccountIdsByRuntime: { host: null, wsl: {} },
  rateLimits: {}
}

vi.mock('@/runtime/runtime-provider-accounts-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    watchProviderAccounts: (
      _target: unknown,
      handlers: { onSnapshot: (snapshot: unknown) => void }
    ) => {
      handlers.onSnapshot({ claude: claudeState, codex: codexState, failedProviders: [] })
      return { close: () => {} }
    }
  }
})

function installApi(): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    minimaxCredentials: { getStatus: vi.fn().mockResolvedValue({ configured: false }) },
    grokAccounts: { getStatus: vi.fn().mockResolvedValue({ configured: false, accounts: [] }) },
    codexConfigSync: { status: vi.fn().mockResolvedValue({ state: 'idle' }) },
    claudeAccounts: {
      getCustomEndpointConfig: vi.fn(),
      getRefreshChainAliasReport: vi
        .fn()
        .mockResolvedValue({ status: 'unavailable', conflictSets: [] })
    },
    codexAccounts: {}
  }
}

function editButton(): HTMLButtonElement {
  return screen.getByText('Edit').closest('button')!
}

describe('AccountsPane custom endpoint edit in WSL (ORCA-1380 B2)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    supportsCapability.mockResolvedValue(true)
    useAppStore.setState({ settingsSearchQuery: '', runtimeEnvironments: [] })
    installApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('disables Edit with a reason for a custom endpoint account that lives in WSL', async () => {
    const settings: GlobalSettings = {
      ...getDefaultSettings('/tmp'),
      localAccountRuntime: 'wsl',
      localAccountWslDistro: 'Ubuntu-24.04'
    }
    render(
      React.createElement(AccountsPane, {
        settings,
        updateSettings: vi.fn(),
        wslSupportedPlatform: true,
        wslAvailable: true,
        wslDistros: ['Ubuntu-24.04']
      })
    )
    await screen.findByText('WSL GLM')

    expect(editButton().disabled).toBe(true)
    expect(editButton().closest('span')!.title).toBe(
      'Editing a custom endpoint account in WSL is not supported yet. Remove it and add it again with the new values.'
    )
  })
})
