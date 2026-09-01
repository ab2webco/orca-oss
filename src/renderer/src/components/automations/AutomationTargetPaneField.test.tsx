// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationDraft } from './AutomationEditorDialog'

const mockUseWorktreeAgentRows = vi.fn()

vi.mock('@/components/sidebar/useWorktreeAgentRows', () => ({
  useWorktreeAgentRows: (worktreeId: string, active: boolean) =>
    mockUseWorktreeAgentRows(worktreeId, active)
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { tabAutoGenerateTitle: false } })
}))

const { AutomationTargetPaneField } = await import('./AutomationTargetPaneField')
const { TooltipProvider } = await import('@/components/ui/tooltip')

function renderField(props: React.ComponentProps<typeof AutomationTargetPaneField>) {
  return render(
    <TooltipProvider>
      <AutomationTargetPaneField {...props} />
    </TooltipProvider>
  )
}

function makeDraft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    name: 'Digest',
    prompt: 'Summarize',
    agentId: 'claude',
    projectId: 'repo-1',
    workspaceMode: 'existing',
    workspaceId: 'wt-1',
    baseBranch: '',
    setupDecision: undefined,
    reuseSession: true,
    targetPaneKey: '',
    precheckCommand: '',
    precheckTimeoutSeconds: '60',
    preset: 'weekdays',
    time: '09:00',
    dayOfWeek: '1',
    customSchedule: '',
    missedRunGraceMinutes: '720',
    scheduleWarning: null,
    ...overrides
  }
}

function makeRow(paneKey: string, title: string) {
  return {
    paneKey,
    entry: {
      state: 'done',
      prompt: 'p',
      updatedAt: 1,
      stateStartedAt: 1,
      paneKey,
      stateHistory: [],
      agentType: 'claude'
    },
    tab: {
      id: paneKey.split(':')[0],
      ptyId: 'pty',
      worktreeId: 'wt-1',
      title,
      customTitle: null,
      color: null
    },
    agentType: 'claude',
    rowSource: 'live' as const,
    state: 'done' as const,
    startedAt: 1
  }
}

afterEach(() => {
  cleanup()
  mockUseWorktreeAgentRows.mockReset()
})

describe('AutomationTargetPaneField', () => {
  it('renders nothing unless session reuse in an existing workspace is on', () => {
    mockUseWorktreeAgentRows.mockReturnValue([])
    const { container } = renderField({
      draft: makeDraft({ reuseSession: false }),
      pickerTriggerClassName: '',
      onDraftChange: vi.fn()
    })
    expect(container).toBeEmptyDOMElement()
    expect(mockUseWorktreeAgentRows).toHaveBeenCalledWith('wt-1', false)
  })

  it('lists live agent panes for the selected workspace and saves the picked pane key', async () => {
    mockUseWorktreeAgentRows.mockReturnValue([makeRow('tab-1:leaf-1', 'Claude terminal')])
    const onDraftChange = vi.fn()
    renderField({
      draft: makeDraft(),
      pickerTriggerClassName: '',
      onDraftChange
    })

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByText('Claude terminal'))

    expect(onDraftChange).toHaveBeenCalled()
    const updater = onDraftChange.mock.calls[0][0] as (d: AutomationDraft) => AutomationDraft
    expect(updater(makeDraft()).targetPaneKey).toBe('tab-1:leaf-1')
  })

  it('keeps a saved pane selectable when it is not currently open', () => {
    mockUseWorktreeAgentRows.mockReturnValue([])
    renderField({
      draft: makeDraft({ targetPaneKey: 'tab-9:leaf-9' }),
      pickerTriggerClassName: '',
      onDraftChange: vi.fn()
    })

    expect(screen.getByRole('combobox')).toHaveTextContent('Saved pane (not open)')
  })
})
