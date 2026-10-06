// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { AutomationDraft } from './AutomationEditorDialog'

const rosterMocks = vi.hoisted(() => ({
  listClaudeAccountsForEnvironment: vi.fn(),
  listCodexAccountsForEnvironment: vi.fn(),
  runtimeEnvironmentSupportsCapability: vi.fn()
}))

vi.mock('@/runtime/runtime-provider-account-roster', () => ({
  listClaudeAccountsForEnvironment: rosterMocks.listClaudeAccountsForEnvironment,
  listCodexAccountsForEnvironment: rosterMocks.listCodexAccountsForEnvironment
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  runtimeEnvironmentSupportsCapability: rosterMocks.runtimeEnvironmentSupportsCapability
}))

const { AutomationAccountField } = await import('./AutomationAccountField')

const claudeRoster = {
  accounts: [
    { id: 'acct-alice', email: 'alice@example.com' },
    { id: 'acct-bob', email: 'bob@example.com' }
  ]
}
const codexRoster = { accounts: [{ id: 'cx-1', email: 'codex@example.com' }] }

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return { id: 'repo-1', path: '/work/repo', displayName: 'repo', ...overrides } as Repo
}

function makeDraft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    name: 'Digest',
    actionKind: 'agent',
    prompt: 'Summarize',
    command: '',
    commandTimeoutSeconds: '300',
    agentId: 'claude',
    projectId: 'repo-1',
    workspaceMode: 'existing',
    workspaceId: 'wt-1',
    baseBranch: '',
    setupDecision: undefined,
    reuseSession: false,
    targetPaneKey: '',
    precheckCommand: '',
    precheckTimeoutSeconds: '60',
    preset: 'weekdays',
    time: '09:00',
    dayOfWeek: '1',
    customSchedule: '',
    missedRunGraceMinutes: '720',
    scheduleWarning: null,
    claudeAccountId: null,
    codexAccountId: null,
    ...overrides
  }
}

function renderField(
  draft: AutomationDraft,
  repo: Repo | null = makeRepo(),
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void = () => {}
) {
  return render(
    <AutomationAccountField
      draft={draft}
      repo={repo}
      triggerClassName=""
      onDraftChange={onDraftChange}
    />
  )
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mockRosters(): void {
  rosterMocks.listClaudeAccountsForEnvironment.mockResolvedValue(claudeRoster)
  rosterMocks.listCodexAccountsForEnvironment.mockResolvedValue(codexRoster)
  rosterMocks.runtimeEnvironmentSupportsCapability.mockResolvedValue(true)
}

describe('AutomationAccountField', () => {
  it('shows the Claude picker for the claude agent and lists the roster', async () => {
    mockRosters()
    renderField(makeDraft())
    const trigger = await screen.findByRole('combobox', { name: 'Claude account' })
    expect(trigger).toHaveTextContent('Inherit (worktree or global)')
    await userEvent.click(trigger)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('alice@example.com')).toBeInTheDocument()
    expect(within(listbox).getByText('bob@example.com')).toBeInTheDocument()
    expect(rosterMocks.listClaudeAccountsForEnvironment).toHaveBeenCalledWith(null)
  })

  it('shows the Codex picker for the codex agent only', async () => {
    mockRosters()
    renderField(makeDraft({ agentId: 'codex' }))
    expect(await screen.findByRole('combobox', { name: 'Codex account' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Claude account' })).toBeNull()
    expect(rosterMocks.listClaudeAccountsForEnvironment).not.toHaveBeenCalled()
  })

  it.each([
    ['another agent', makeDraft({ agentId: 'gemini' }), makeRepo()],
    ['a command-only automation', makeDraft({ actionKind: 'command' }), makeRepo()],
    ['an SSH repo', makeDraft(), makeRepo({ connectionId: 'ssh-1' })],
    ['no repo', makeDraft(), null]
  ])('renders nothing for %s', async (_label, draft, repo) => {
    mockRosters()
    const { container } = renderField(draft, repo)
    expect(container).toBeEmptyDOMElement()
    expect(rosterMocks.listClaudeAccountsForEnvironment).not.toHaveBeenCalled()
  })

  it('reads the roster of the runtime host that owns the repo', async () => {
    mockRosters()
    renderField(makeDraft(), makeRepo({ executionHostId: 'runtime:env-7' }))
    await screen.findByRole('combobox', { name: 'Claude account' })
    await waitFor(() =>
      expect(rosterMocks.listClaudeAccountsForEnvironment).toHaveBeenCalledWith('env-7')
    )
    expect(rosterMocks.runtimeEnvironmentSupportsCapability).toHaveBeenCalledWith(
      'env-7',
      'automation.account-pin.v1'
    )
  })

  it('disables the picker with a note when the host lacks the capability', async () => {
    mockRosters()
    rosterMocks.runtimeEnvironmentSupportsCapability.mockResolvedValue(false)
    renderField(makeDraft(), makeRepo({ executionHostId: 'runtime:env-7' }))
    const trigger = await screen.findByRole('combobox', { name: 'Claude account' })
    await waitFor(() => expect(trigger).toBeDisabled())
    expect(screen.getByText(/Update the host to pick an account/)).toBeInTheDocument()
  })

  it('flags a saved account that is no longer in the roster', async () => {
    mockRosters()
    renderField(makeDraft({ claudeAccountId: 'acct-gone' }))
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Claude account' })).toHaveTextContent(
      'Removed account'
    )
  })

  it('shows the saved account email without a warning when it is still present', async () => {
    mockRosters()
    renderField(makeDraft({ claudeAccountId: 'acct-bob' }))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Claude account' })).toHaveTextContent(
        'bob@example.com'
      )
    )
    expect(screen.queryByText(/no longer available/)).toBeNull()
  })

  it('writes the picked account into the draft and clears it back to inherit', async () => {
    mockRosters()
    const changes: AutomationDraft[] = []
    const onDraftChange = vi.fn((updater: (current: AutomationDraft) => AutomationDraft) => {
      changes.push(updater(makeDraft({ claudeAccountId: 'acct-bob' })))
    })
    renderField(makeDraft({ claudeAccountId: 'acct-bob' }), makeRepo(), onDraftChange)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Claude account' }))
    await userEvent.click(await screen.findByRole('option', { name: 'alice@example.com' }))
    expect(changes.at(-1)?.claudeAccountId).toBe('acct-alice')

    await userEvent.click(screen.getByRole('combobox', { name: 'Claude account' }))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Inherit (worktree or global)' })
    )
    expect(changes.at(-1)?.claudeAccountId).toBeNull()
  })

  it('writes the Codex pick into codexAccountId', async () => {
    mockRosters()
    const changes: AutomationDraft[] = []
    renderField(makeDraft({ agentId: 'codex' }), makeRepo(), (updater) => {
      changes.push(updater(makeDraft({ agentId: 'codex' })))
    })
    await userEvent.click(await screen.findByRole('combobox', { name: 'Codex account' }))
    await userEvent.click(await screen.findByRole('option', { name: 'codex@example.com' }))
    expect(changes.at(-1)?.codexAccountId).toBe('cx-1')
    expect(changes.at(-1)?.claudeAccountId).toBeNull()
  })
})
