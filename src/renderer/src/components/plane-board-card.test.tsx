// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runtimeMocks, storeMocks, toastMocks } = vi.hoisted(() => ({
  runtimeMocks: { planeDeleteWorkItem: vi.fn() },
  storeMocks: { setContextualToursBlockingSurfaceVisible: vi.fn() },
  toastMocks: { error: vi.fn() }
}))

vi.mock('@/runtime/runtime-plane-client', () => runtimeMocks)
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeMocks) => unknown) => selector(storeMocks)
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

import { ConfirmationDialogProvider, useConfirmationDialog } from './confirmation-dialog'
import { PlaneBoardCard } from './plane-board-card'
import { confirmAndDeletePlaneWorkItem } from './plane-board-card-delete'
import type { PlaneWorkItem } from '../../../shared/plane-types'

afterEach(cleanup)

const item: PlaneWorkItem = {
  id: 'work-item-1',
  identifier: 'ORCA-84',
  sequenceId: 84,
  workspaceSlug: 'acme',
  workspaceId: 'workspace-1',
  title: 'Keep card actions contained',
  url: 'https://app.plane.so/acme/browse/ORCA-84/',
  project: { id: 'project-1', identifier: 'ORCA', name: 'Orca' },
  state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
  labels: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function CardHarness({ onOpenItem }: { onOpenItem: (selected: PlaneWorkItem) => void }) {
  const confirm = useConfirmationDialog()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  return (
    <DndContext sensors={sensors}>
      <PlaneBoardCard
        item={item}
        selected={false}
        onOpenItem={onOpenItem}
        onDeleteItem={(selected) => {
          void confirmAndDeletePlaneWorkItem({
            confirm,
            item: selected,
            projectId: 'project-1',
            workspaceId: 'workspace-1',
            providerSettings: null
          })
        }}
      />
    </DndContext>
  )
}

function renderCard(onOpenItem = vi.fn()) {
  render(
    <ConfirmationDialogProvider>
      <CardHarness onOpenItem={onOpenItem} />
    </ConfirmationDialogProvider>
  )
  return { onOpenItem }
}

async function selectDelete(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Work item actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete work item' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  runtimeMocks.planeDeleteWorkItem.mockResolvedValue({ ok: true })
})

describe('PlaneBoardCard actions', () => {
  it('does not open the item when Delete is selected', async () => {
    const user = userEvent.setup()
    const { onOpenItem } = renderCard()

    await selectDelete(user)

    expect(
      await screen.findByRole('heading', { name: 'Delete work item ORCA-84?' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '«Keep card actions contained» will be permanently deleted. This cannot be undone.'
      )
    ).toBeInTheDocument()
    expect(onOpenItem).not.toHaveBeenCalled()
  })

  it('does not open the item when deletion is confirmed', async () => {
    const user = userEvent.setup()
    const { onOpenItem } = renderCard()

    await selectDelete(user)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(runtimeMocks.planeDeleteWorkItem).toHaveBeenCalledOnce())
    expect(onOpenItem).not.toHaveBeenCalled()
  })

  it('does not open the item when deletion is cancelled', async () => {
    const user = userEvent.setup()
    const { onOpenItem } = renderCard()

    await selectDelete(user)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Delete work item ORCA-84?' })
      ).not.toBeInTheDocument()
    )
    expect(runtimeMocks.planeDeleteWorkItem).not.toHaveBeenCalled()
    expect(onOpenItem).not.toHaveBeenCalled()
  })

  it('opens the item when the card body is clicked', async () => {
    const user = userEvent.setup()
    const { onOpenItem } = renderCard()

    await user.click(screen.getByRole('heading', { name: item.title }))

    expect(onOpenItem).toHaveBeenCalledOnce()
    expect(onOpenItem).toHaveBeenCalledWith(item)
  })
})
