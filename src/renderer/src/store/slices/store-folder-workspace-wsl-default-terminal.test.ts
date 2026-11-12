import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { FLOATING_TERMINAL_WORKTREE_ID, getDefaultSettings } from '../../../../shared/constants'
import type { GlobalWindowsRuntimeDefault } from '../../../../shared/project-execution-runtime'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { createTestStore, seedStore } from './store-test-helpers'
import { createStoreCascadesMockApi } from './store-cascades-test-harness'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn(() => [])
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createStoreCascadesMockApi()

const folderKey = folderWorkspaceKey('folder-1')

function seedWindowsStore(localWindowsRuntimeDefault: GlobalWindowsRuntimeDefault) {
  const store = createTestStore()
  seedStore(store, {
    settings: {
      ...getDefaultSettings('/tmp'),
      terminalWindowsShell: 'powershell.exe',
      localWindowsRuntimeDefault
    },
    folderWorkspaces: [
      {
        id: 'folder-1',
        projectGroupId: 'group-1',
        name: 'notes',
        folderPath: 'C:\\Users\\dev\\notes',
        linkedTask: null,
        comment: '',
        isArchived: false,
        isUnread: false
      } as never
    ]
  })
  return store
}

describe('worktree-less terminals with a WSL default runtime on Windows', () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      configurable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true
    })
  })

  it('opens a folder workspace terminal in WSL', () => {
    const store = seedWindowsStore({ kind: 'wsl', distro: 'Ubuntu-24.04' })
    expect(store.getState().createTab(folderKey).shellOverride).toBe('wsl.exe')
  })

  it('opens the floating terminal in WSL', () => {
    const store = seedWindowsStore({ kind: 'wsl', distro: 'Ubuntu-24.04' })
    expect(store.getState().createTab(FLOATING_TERMINAL_WORKTREE_ID).shellOverride).toBe('wsl.exe')
  })

  it('keeps PowerShell when picked from the per-tab selector in a folder', () => {
    const store = seedWindowsStore({ kind: 'wsl', distro: 'Ubuntu-24.04' })
    expect(store.getState().createTab(folderKey, undefined, 'powershell.exe').shellOverride).toBe(
      'powershell.exe'
    )
  })

  it('keeps a host-forced setup terminal on the Windows shell', () => {
    const store = seedWindowsStore({ kind: 'wsl', distro: 'Ubuntu-24.04' })
    expect(
      store.getState().createTab(folderKey, undefined, undefined, { forceHostRuntime: true })
        .shellOverride
    ).toBe('powershell.exe')
  })

  it('keeps the Windows shell setting when the default runtime is the Windows host', () => {
    const store = seedWindowsStore({ kind: 'windows-host' })
    expect(store.getState().createTab(folderKey).shellOverride).toBe('powershell.exe')
  })
})
