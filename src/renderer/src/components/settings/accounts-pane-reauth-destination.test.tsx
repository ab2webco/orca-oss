// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { HOST_ACCOUNT_REAUTH_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
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

const claudeState = {
  accounts: [
    {
      id: 'claude-1',
      email: 'claude@example.com',
      managedAuthPath: '/srv/claude',
      managedAuthRuntime: 'host' as const,
      wslDistro: null,
      wslLinuxAuthPath: null,
      authMethod: 'subscription-oauth' as const,
      organizationUuid: null,
      organizationName: null,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
  ],
  activeAccountId: null,
  activeAccountIdsByRuntime: { host: null, wsl: {} },
  rateLimits: {}
}

const codexState = {
  accounts: [
    {
      id: 'codex-1',
      email: 'codex@example.com',
      managedHomePath: '/srv/codex',
      managedHomeRuntime: 'host' as const,
      wslDistro: null,
      wslLinuxHomePath: null,
      providerAccountId: null,
      workspaceLabel: null,
      workspaceAccountId: null,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
  ],
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

const claudeReauthenticate = vi.fn()
const codexReauthenticate = vi.fn()

function installApi(): void {
  const api = {
    minimaxCredentials: { getStatus: vi.fn().mockResolvedValue({ configured: false }) },
    grokAccounts: { getStatus: vi.fn().mockResolvedValue({ configured: false, accounts: [] }) },
    codexConfigSync: { status: vi.fn().mockResolvedValue({ state: 'idle' }) },
    claudeAccounts: {
      reauthenticate: claudeReauthenticate.mockResolvedValue(claudeState),
      getRefreshChainAliasReport: vi
        .fn()
        .mockResolvedValue({ status: 'unavailable', conflictSets: [] })
    },
    codexAccounts: { reauthenticate: codexReauthenticate.mockResolvedValue(codexState) }
  }
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = api
}

function renderPane(settings: GlobalSettings): void {
  render(
    React.createElement(AccountsPane, {
      settings,
      updateSettings: vi.fn()
    })
  )
}

/** The rows carry one button per provider with this label. */
function reauthenticateButtons(): HTMLButtonElement[] {
  return screen
    .getAllByText('Re-authenticate')
    .map((node) => node.closest('button'))
    .filter((node): node is HTMLButtonElement => node !== null)
}

describe('AccountsPane re-authentication destination', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    beginHostAccountLogin.mockReturnValue(new Promise(() => {}))
    supportsCapability.mockResolvedValue(true)
    useAppStore.setState({ settingsSearchQuery: '', runtimeEnvironments: [] })
    installApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('re-authenticates a Claude account on the server, never through the local IPC', async () => {
    renderPane({ ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: 'env-1' })
    await screen.findByText('claude@example.com')

    const [claudeButton] = reauthenticateButtons()
    expect(claudeButton.disabled).toBe(false)
    claudeButton.click()

    await vi.waitFor(() => {
      expect(beginHostAccountLogin).toHaveBeenCalledWith(
        expect.objectContaining({ activeRuntimeEnvironmentId: 'env-1' }),
        'claude',
        'claude-1'
      )
    })
    expect(claudeReauthenticate).not.toHaveBeenCalled()
  })

  it('re-authenticates a Codex account on the server, never through the local IPC', async () => {
    renderPane({ ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: 'env-1' })
    await screen.findByText('claude@example.com')

    const codexButton = reauthenticateButtons().at(-1)!
    codexButton.click()

    await vi.waitFor(() => {
      expect(beginHostAccountLogin).toHaveBeenCalledWith(expect.anything(), 'codex', 'codex-1')
    })
    expect(codexReauthenticate).not.toHaveBeenCalled()
  })

  it('keeps the desktop lane on the local IPC when no server owns the accounts', async () => {
    renderPane(getDefaultSettings('/tmp'))
    await screen.findByText('claude@example.com')

    reauthenticateButtons()[0].click()

    await vi.waitFor(() => {
      expect(claudeReauthenticate).toHaveBeenCalledWith({ accountId: 'claude-1' })
    })
    expect(beginHostAccountLogin).not.toHaveBeenCalled()
  })

  it('disables the button with a reason when the server cannot re-authenticate in place', async () => {
    // An older server knows accounts.host-login.v1 only: sending the account id
    // there adds a duplicate row and answers ok.
    supportsCapability.mockImplementation(
      async (_environmentId: string, capability: string) =>
        capability !== HOST_ACCOUNT_REAUTH_RUNTIME_CAPABILITY
    )
    renderPane({ ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: 'env-1' })
    await screen.findByText('claude@example.com')

    await vi.waitFor(() => {
      expect(reauthenticateButtons()[0].disabled).toBe(true)
    })
    expect(reauthenticateButtons()[0].title).toContain('too old to re-authenticate')
    reauthenticateButtons()[0].click()
    expect(beginHostAccountLogin).not.toHaveBeenCalled()
    expect(claudeReauthenticate).not.toHaveBeenCalled()
  })
})
