// @vitest-environment happy-dom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NewWorkspaceComposerCard from './NewWorkspaceComposerCard'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'

const storeMocks = vi.hoisted(() => ({
  closeModal: vi.fn(),
  openModal: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  setRuntimeEnvironmentStatus: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        closeModal: storeMocks.closeModal,
        openModal: storeMocks.openModal,
        openSettingsPage: storeMocks.openSettingsPage,
        openSettingsTarget: storeMocks.openSettingsTarget,
        setRuntimeEnvironmentStatus: storeMocks.setRuntimeEnvironmentStatus,
        activeModal: 'none',
        settings: { defaultTuiAgent: null, disabledTuiAgents: [] },
        updateSettings: vi.fn()
      }),
    {
      getState: () => ({
        setRuntimeEnvironmentStatus: storeMocks.setRuntimeEnvironmentStatus
      })
    }
  )
}))

vi.mock('@/components/contextual-tours/use-contextual-tour', () => ({
  useContextualTour: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/agent/AgentCombobox', () => ({
  default: () => <button type="button">Agent picker</button>
}))

// Stub the host-add dialog to its `mode` — the composer's job is to open it with the right
// mode; the dialog's own SSH/runtime IPC has separate coverage.
vi.mock('@/components/sidebar/AddRemoteHostDialog', () => ({
  AddRemoteHostDialog: ({ mode }: { mode: 'ssh' | 'server' | null }) =>
    mode ? <div data-testid="add-remote-host-dialog" data-mode={mode} /> : null
}))

vi.mock('@/components/sparse/SparseCheckoutPresetSelect', () => ({
  default: () => <div data-testid="sparse-select" />
}))

vi.mock('@/components/new-workspace/SmartWorkspaceNameField', () => ({
  default: ({
    branchesEnabled,
    repoBackedSourcesDisabled,
    repoBackedSearchRepos = []
  }: {
    branchesEnabled?: boolean
    repoBackedSourcesDisabled?: boolean
    repoBackedSearchRepos?: { displayName: string }[]
  }) => (
    <input
      aria-label="workspace name"
      data-branches-enabled={branchesEnabled ? 'true' : 'false'}
      data-repo-backed-search-count={repoBackedSearchRepos.length}
      data-repo-backed-search-names={repoBackedSearchRepos
        .map((repo) => repo.displayName)
        .join(',')}
      data-repo-backed-sources-disabled={repoBackedSourcesDisabled ? 'true' : 'false'}
    />
  )
}))

vi.mock('@/components/new-workspace/ProjectCombobox', () => ({
  default: ({
    options,
    value,
    onValueChange
  }: {
    options: NewWorkspaceProjectOption[]
    value: string | null
    onValueChange: (value: string) => void
  }) => (
    <div data-testid="project-combobox" data-value={value ?? ''}>
      {options.map((option) => (
        <button key={option.id} type="button" onClick={() => onValueChange(option.id)}>
          {option.displayName}
        </button>
      ))}
    </div>
  )
}))

const projectOptions: NewWorkspaceProjectOption[] = [
  {
    kind: 'project-group',
    id: 'project-group:platform',
    projectGroupId: 'platform',
    displayName: 'Platform',
    badgeColor: 'var(--muted-foreground)',
    detail: '/workspace/platform',
    parentPath: '/workspace/platform',
    connectionId: null
  }
]

function renderCard(
  overrides: Partial<React.ComponentProps<typeof NewWorkspaceComposerCard>> = {}
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <NewWorkspaceComposerCard
        quickAgent={null}
        onQuickAgentChange={() => {}}
        claudeAccounts={[]}
        claudeAccountId={null}
        onClaudeAccountIdChange={() => {}}
        eligibleRepos={[]}
        repoId="repo-a"
        projectOptions={projectOptions}
        selectedProjectId="project-group:platform"
        selectedRepoIsGit
        onRepoChange={() => {}}
        onProjectChange={() => {}}
        primaryActionLabel="Create workspace"
        name=""
        onNameValueChange={() => {}}
        onSmartGitHubItemSelect={() => {}}
        onSmartGitLabItemSelect={() => {}}
        onSmartBranchSelect={() => {}}
        onSmartLinearIssueSelect={() => {}}
        smartNameSelection={null}
        onClearSmartNameSelection={() => {}}
        canReuseSelectedBranch={false}
        reuseSelectedBranch={false}
        onReuseSelectedBranchChange={() => {}}
        branchNameOverride=""
        onBranchNameOverrideChange={() => {}}
        forkPushWarning={null}
        detectedAgentIds={null}
        onOpenAgentSettings={() => {}}
        advancedOpen={false}
        onToggleAdvanced={() => {}}
        createDisabled={false}
        projectError={null}
        creating={false}
        onCreate={() => {}}
        note=""
        onNoteChange={() => {}}
        setupConfig={null}
        requiresExplicitSetupChoice={false}
        setupDecision={null}
        onSetupDecisionChange={() => {}}
        setupAgentStartupPolicy="start-immediately"
        onSetupAgentStartupPolicyChange={() => {}}
        shouldWaitForSetupCheck={false}
        resolvedSetupDecision={null}
        createError={null}
        selectedRepoConnectionId={null}
        selectedRepoSshStatus={null}
        selectedRepoRequiresConnection={false}
        selectedRepoConnectInProgress={false}
        onConnectSelectedRepo={async () => {}}
        canUseSparseCheckout={false}
        sparsePresets={[]}
        sparseSelectedPresetId={null}
        onSparseSelectPreset={() => {}}
        branchesEnabled={false}
        setupControlsEnabled={false}
        sparseControlsEnabled={false}
        {...overrides}
      />
    )
  })
  return { container, root }
}

const claudeAccounts = [
  { id: 'acct-alice', email: 'alice@example.com' },
  { id: 'acct-bob', email: 'bob@example.com' }
] as unknown as ClaudeManagedAccountSummary[]
let current: { container: HTMLDivElement; root: Root } | null = null

describe('NewWorkspaceComposerCard Claude account selector', () => {
  afterEach(() => {
    act(() => current?.root.unmount())
    current?.container.remove()
    current = null
  })

  const accountLabel = (): HTMLLabelElement | undefined =>
    [...(current?.container.querySelectorAll('label') ?? [])].find(
      (label) => label.textContent === 'Account'
    ) as HTMLLabelElement | undefined

  const accountTrigger = (): HTMLElement | null | undefined =>
    accountLabel()?.closest('.space-y-1')?.querySelector<HTMLElement>('button[role="combobox"]')

  it('hides the Account selector when no managed accounts exist', () => {
    current = renderCard({ claudeAccounts: [] })
    expect(accountLabel()).toBeUndefined()
    expect(accountTrigger()).toBeFalsy()
  })

  it('renders the selector and reflects the pinned account, defaulting to Inherit global', () => {
    current = renderCard({ claudeAccounts, claudeAccountId: null })
    expect(accountLabel()).toBeTruthy()
    expect(accountTrigger()?.textContent).toContain('Inherit global')

    act(() => current?.root.unmount())
    current?.container.remove()

    current = renderCard({ claudeAccounts, claudeAccountId: 'acct-bob' })
    expect(accountTrigger()?.textContent).toContain('bob@example.com')
  })

  it('emits the account id when an account is chosen and null for Inherit global', () => {
    // Radix Select relies on pointer-capture + scrollIntoView, which happy-dom
    // does not implement; polyfill them so the listbox opens under test.
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
    const originalProto = {
      hasPointerCapture: proto.hasPointerCapture,
      setPointerCapture: proto.setPointerCapture,
      releasePointerCapture: proto.releasePointerCapture,
      scrollIntoView: proto.scrollIntoView
    }
    proto.hasPointerCapture = () => false
    proto.setPointerCapture = () => {}
    proto.releasePointerCapture = () => {}
    proto.scrollIntoView = () => {}

    const openAndPick = (optionText: string): void => {
      const trigger = accountTrigger()
      expect(trigger).toBeTruthy()
      act(() => {
        trigger?.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }))
        trigger?.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0 }))
        trigger?.click()
      })
      const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (item) => item.textContent === optionText
      )
      expect(option, `option "${optionText}" should be present`).toBeTruthy()
      act(() => {
        option?.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }))
        option?.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0 }))
        option?.click()
      })
    }

    try {
      const changes: (string | null)[] = []
      current = renderCard({
        claudeAccounts,
        claudeAccountId: null,
        onClaudeAccountIdChange: (next) => changes.push(next)
      })

      openAndPick('alice@example.com')
      expect(changes).toEqual(['acct-alice'])

      act(() => current?.root.unmount())
      current?.container.remove()

      const inheritChanges: (string | null)[] = []
      current = renderCard({
        claudeAccounts,
        claudeAccountId: 'acct-alice',
        onClaudeAccountIdChange: (next) => inheritChanges.push(next)
      })

      openAndPick('Inherit global')
      expect(inheritChanges).toEqual([null])
    } finally {
      Object.assign(proto, originalProto)
    }
  })
})
