// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { PluginSettingsRow } from './PluginSettingsRow'

vi.mock('../ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => <button onClick={onSelect}>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const plugin: PluginHostListEntry = {
  pluginKey: 'stablyai.orca-skills',
  consentFingerprint: 'sha256-consent',
  name: 'Orca Skills',
  version: '1.0.0',
  publisher: 'stablyai',
  status: 'disabled',
  needsReconsent: false,
  isDev: false,
  official: true,
  bundled: true,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  restarts: 0,
  blockedByKillList: {
    reason: 'A vulnerable release was revoked',
    advisoryUrl: 'https://onorca.dev/advisories/orca-skills'
  },
  source: {
    kind: 'bundled',
    reference: 'bundled:stablyai.orca-skills',
    resolvedCommit: null,
    contentHash: 'sha256-content'
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PluginSettingsRow', () => {
  it('shows official provenance and prevents re-enabling killed plugins', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <PluginSettingsRow
          plugin={plugin}
          busy={false}
          logsOpen={false}
          settingsOpen={false}
          onReview={vi.fn()}
          onToggleEnabled={vi.fn()}
          onToggleLogs={vi.fn()}
          onToggleSettings={vi.fn()}
          onSaveSetting={vi.fn()}
          onRollbackRequest={vi.fn()}
          onRemoveRequest={vi.fn()}
        />
      )
    })

    // Why: official provenance renders as an icon with an accessible label, not badge text.
    expect(container.querySelector('[aria-label="Official"]')).toBeTruthy()
    expect(container.textContent).toContain('Bundled')
    expect(container.textContent).toContain('A vulnerable release was revoked')
    expect(container.textContent).toContain('View advisory')
    expect(container.textContent).not.toContain('Remove')
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Enable Orca Skills"]')?.disabled
    ).toBe(true)
    act(() => root.unmount())
  })
})

const configurable: PluginHostListEntry = {
  ...plugin,
  pluginKey: 'orca-samples.webhook',
  name: 'Webhook',
  status: 'running',
  bundled: false,
  official: false,
  blockedByKillList: undefined,
  source: undefined,
  settings: [
    {
      key: 'webhookUrl',
      type: 'string',
      label: 'Webhook URL',
      secret: false,
      required: true,
      configured: false
    },
    {
      key: 'token',
      type: 'string',
      label: 'Token',
      secret: true,
      required: true,
      configured: true
    },
    {
      key: 'verbose',
      type: 'boolean',
      label: 'Verbose',
      secret: false,
      required: false,
      value: false,
      configured: true
    }
  ],
  needsSetup: true
}

async function renderRow(
  entry: PluginHostListEntry,
  overrides: Partial<React.ComponentProps<typeof PluginSettingsRow>> = {}
): Promise<{ container: HTMLDivElement; unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <PluginSettingsRow
        plugin={entry}
        busy={false}
        logsOpen={false}
        settingsOpen={false}
        onReview={vi.fn()}
        onToggleEnabled={vi.fn()}
        onToggleLogs={vi.fn()}
        onToggleSettings={vi.fn()}
        onSaveSetting={vi.fn()}
        onRollbackRequest={vi.fn()}
        onRemoveRequest={vi.fn()}
        {...overrides}
      />
    )
  })
  return { container, unmount: () => act(() => root.unmount()) }
}

describe('PluginSettingsRow declared settings', () => {
  it('marks an unconfigured plugin as needing setup instead of running', async () => {
    const { container, unmount } = await renderRow(configurable)
    expect(container.textContent).toContain('Needs setup')
    expect(container.textContent).not.toContain('Running')
    expect(container.textContent).toContain('Finish setup')
    unmount()
  })

  it('reads as running once every required setting has a value', async () => {
    const ready: PluginHostListEntry = {
      ...configurable,
      needsSetup: undefined,
      settings: configurable.settings?.map((setting) => ({ ...setting, configured: true }))
    }
    const { container, unmount } = await renderRow(ready)
    expect(container.textContent).toContain('Running')
    expect(container.textContent).not.toContain('Needs setup')
    expect(container.textContent).toContain('Configure')
    unmount()
  })

  it('renders no configure surface at all when the manifest declares no settings', async () => {
    const { container, unmount } = await renderRow(
      { ...configurable, settings: undefined, needsSetup: undefined },
      { settingsOpen: true }
    )
    expect(container.textContent).not.toContain('Configure')
    expect(container.querySelector('[data-plugin-settings-form]')).toBeNull()
    unmount()
  })

  it('masks a secret field, never prefills it, and commits a typed value on blur', async () => {
    const onSaveSetting = vi.fn()
    const { container, unmount } = await renderRow(configurable, {
      settingsOpen: true,
      onSaveSetting
    })
    const secret = container.querySelector<HTMLInputElement>('[data-setting-key="token"]')!
    expect(secret.type).toBe('password')
    expect(secret.value).toBe('')

    const url = container.querySelector<HTMLInputElement>('[data-setting-key="webhookUrl"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )!.set!
      setter.call(url, 'https://hooks.example.test/abc')
      url.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      // React maps onBlur to the bubbling focusout event.
      url.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onSaveSetting).toHaveBeenCalledWith(
      'orca-samples.webhook',
      'webhookUrl',
      'https://hooks.example.test/abc'
    )
    unmount()
  })
})
