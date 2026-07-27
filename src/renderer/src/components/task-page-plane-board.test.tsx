// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { confirmationMocks, runtimeMocks, storeMocks, toastMocks } = vi.hoisted(() => ({
  confirmationMocks: { confirm: vi.fn() },
  runtimeMocks: {
    planeCreateWorkItem: vi.fn(),
    planeCreateState: vi.fn(),
    planeDeleteState: vi.fn(),
    planeDeleteWorkItem: vi.fn(),
    planeListStates: vi.fn(),
    planeUpdateState: vi.fn(),
    planeUpdateWorkItem: vi.fn()
  },
  storeMocks: { patchPlaneWorkItem: vi.fn() },
  toastMocks: { error: vi.fn() }
}))

vi.mock('@/components/confirmation-dialog', () => ({
  useConfirmationDialog: () => confirmationMocks.confirm
}))
vi.mock('@/runtime/runtime-plane-client', () => runtimeMocks)
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeMocks) => unknown) => selector(storeMocks)
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

import { TaskPagePlaneBoard } from './task-page-plane-board'
import type { PlaneWorkItem } from '../../../shared/plane-types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function planeWorkItem(identifier: string, title: string): PlaneWorkItem {
  return {
    id: `ws-1:${identifier}`,
    identifier,
    sequenceId: 1,
    workspaceSlug: 'acme',
    workspaceId: 'ws-1',
    title,
    url: `https://app.plane.so/acme/browse/${identifier}/`,
    project: { id: 'proj-1', identifier: identifier.split('-')[0], name: 'Project' },
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function renderBoard(item: PlaneWorkItem): ReturnType<typeof render> {
  return render(
    <TaskPagePlaneBoard
      items={[item]}
      projectId="proj-1"
      workspaceId="ws-1"
      providerSettings={null}
      selectedItemId={null}
      getStateTone={() => ''}
      onOpenItem={vi.fn()}
    />
  )
}

async function openCardMenuAndDelete(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Work item actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete work item' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  runtimeMocks.planeListStates.mockResolvedValue([])
})

describe('TaskPagePlaneBoard card deletion', () => {
  it('asks for confirmation naming the work item, then deletes it', async () => {
    confirmationMocks.confirm.mockResolvedValue(true)
    runtimeMocks.planeDeleteWorkItem.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    renderBoard(planeWorkItem('ORCA-7', 'Fix the flux capacitor'))

    await openCardMenuAndDelete(user)

    expect(confirmationMocks.confirm).toHaveBeenCalledWith({
      title: 'Delete work item ORCA-7?',
      description: '«Fix the flux capacitor» will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'destructive'
    })
    await waitFor(() =>
      expect(runtimeMocks.planeDeleteWorkItem).toHaveBeenCalledWith(
        null,
        { projectId: 'proj-1', workItemId: 'ws-1:ORCA-7' },
        'ws-1'
      )
    )
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('deletes nothing when the confirmation is declined', async () => {
    confirmationMocks.confirm.mockResolvedValue(false)
    const user = userEvent.setup()
    renderBoard(planeWorkItem('ORCA-7', 'Fix the flux capacitor'))

    await openCardMenuAndDelete(user)

    await waitFor(() => expect(confirmationMocks.confirm).toHaveBeenCalled())
    expect(runtimeMocks.planeDeleteWorkItem).not.toHaveBeenCalled()
  })

  it('surfaces a rejected delete and leaves the card in place', async () => {
    confirmationMocks.confirm.mockResolvedValue(true)
    runtimeMocks.planeDeleteWorkItem.mockResolvedValue({
      ok: false,
      error: 'Plane rejected the delete.'
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    renderBoard(planeWorkItem('ORCA-7', 'Fix the flux capacitor'))

    await openCardMenuAndDelete(user)

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('Failed to delete work item.')
    )
    expect(consoleError).toHaveBeenCalledWith(
      '[plane-board] mutation failed:',
      'Plane rejected the delete.'
    )
    // No optimistic removal: the card must survive the failed delete.
    expect(screen.getByText('Fix the flux capacitor')).toBeInTheDocument()
  })
})

describe('TaskPagePlaneBoard card creation failures', () => {
  it('keeps the typed title and hides the raw network code', async () => {
    runtimeMocks.planeCreateWorkItem.mockResolvedValue({
      ok: false,
      error: 'net::ERR_INTERNET_DISCONNECTED'
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    renderBoard(planeWorkItem('ORCA-7', 'Existing work item'))

    await user.click(screen.getByRole('button', { name: 'Add work item' }))
    const titleInput = screen.getByRole('textbox', { name: 'Work item title' })
    await user.type(titleInput, 'Keep this title')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "You're offline. Check your connection and try again."
      )
    )
    expect(titleInput).toHaveValue('Keep this title')
    expect(consoleError).toHaveBeenCalledWith(
      '[plane-board] mutation failed:',
      'net::ERR_INTERNET_DISCONNECTED'
    )
  })
})
