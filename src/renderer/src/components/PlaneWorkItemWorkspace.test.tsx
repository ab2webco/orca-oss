// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  PlaneComment,
  PlaneState,
  PlaneUser,
  PlaneWorkItem
} from '../../../shared/plane-types'

const { runtimeMocks, storeMocks } = vi.hoisted(() => ({
  runtimeMocks: {
    planeGetWorkItem: vi.fn(),
    planeListStates: vi.fn(),
    planeListMembers: vi.fn(),
    planeListWorkItemComments: vi.fn(),
    planeAddWorkItemComment: vi.fn(),
    planeUpdateWorkItem: vi.fn()
  },
  storeMocks: {
    patchPlaneWorkItem: vi.fn(),
    settings: { activeRuntimeEnvironmentId: null }
  }
}))

vi.mock('@/runtime/runtime-plane-client', () => runtimeMocks)

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeMocks) => unknown) => selector(storeMocks)
}))

// Why: window.api.shell/window.api.ui are only provided by the Electron
// preload bridge, which is absent under happy-dom.
;(globalThis as unknown as { window: { api: unknown } }).window = globalThis as never
;(globalThis as unknown as { api: Record<string, unknown> }).api = {
  shell: { openUrl: vi.fn() },
  ui: { writeClipboardText: vi.fn(async () => {}) }
}

import PlaneWorkItemWorkspace from './PlaneWorkItemWorkspace'

function planeWorkItem(overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: 'item-1',
    identifier: 'PROJ-7',
    sequenceId: 7,
    workspaceSlug: 'acme',
    workspaceId: 'ws-1',
    title: 'Fix the thing',
    description: 'Some description',
    url: 'https://app.plane.so/acme/browse/PROJ-7/',
    project: { id: 'proj-1', identifier: 'PROJ', name: 'Project' },
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    priority: 'medium',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function planeState(id: string, name: string, group: string, sequence: number): PlaneState {
  return { id, name, group, sequence }
}

function planeUser(id: string, displayName: string): PlaneUser {
  return { id, displayName }
}

function planeComment(id: string, body: string): PlaneComment {
  return { id, body, createdAt: '2026-01-01T00:00:00.000Z' }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderWorkspace(props: {
  item: PlaneWorkItem | null
  onUse?: (item: PlaneWorkItem) => void
  onClose?: () => void
}): Promise<void> {
  await act(async () => {
    render(
      <TooltipProvider>
        <PlaneWorkItemWorkspace
          item={props.item}
          onUse={props.onUse ?? vi.fn()}
          onClose={props.onClose ?? vi.fn()}
        />
      </TooltipProvider>
    )
  })
}

describe('PlaneWorkItemWorkspace', () => {
  it('renders an empty state when no work item is selected', async () => {
    await renderWorkspace({ item: null })

    expect(screen.getByText('Select a work item to preview it here.')).toBeInTheDocument()
  })

  it('renders header, priority, and description for the selected work item', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])

    await renderWorkspace({ item: planeWorkItem() })

    expect(screen.getByText('Fix the thing')).toBeInTheDocument()
    expect(screen.getAllByText('PROJ-7')[0]).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('Some description')).toBeInTheDocument()
  })

  it('calls onUse when Start workspace is clicked', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])
    const onUse = vi.fn()
    const user = userEvent.setup()

    await renderWorkspace({ item: planeWorkItem(), onUse })
    await user.click(screen.getByRole('button', { name: 'Start workspace' }))

    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'PROJ-7' }))
  })

  it('calls onClose when the close button is clicked', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])
    const onClose = vi.fn()
    const user = userEvent.setup()

    await renderWorkspace({ item: planeWorkItem(), onClose })
    await user.click(screen.getByRole('button', { name: 'Close Plane work item preview' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('loads and lists comments for the selected work item', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([planeComment('c1', 'First comment')])

    await renderWorkspace({ item: planeWorkItem() })

    await waitFor(() => {
      expect(screen.getByText('First comment')).toBeInTheDocument()
    })
  })

  it('submits a new comment and appends it optimistically', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([])
    runtimeMocks.planeListMembers.mockResolvedValue([])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])
    runtimeMocks.planeAddWorkItemComment.mockResolvedValue({ ok: true, id: 'new-comment' })
    const user = userEvent.setup()

    await renderWorkspace({ item: planeWorkItem() })
    const textarea = screen.getByPlaceholderText('Add a Plane comment...')
    await user.type(textarea, 'A new comment')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => {
      expect(runtimeMocks.planeAddWorkItemComment).toHaveBeenCalledWith(
        expect.anything(),
        'proj-1',
        'item-1',
        'A new comment',
        'ws-1'
      )
    })
    expect(screen.getByText('A new comment')).toBeInTheDocument()
  })

  it('changes state via the state popover and calls planeUpdateWorkItem', async () => {
    runtimeMocks.planeGetWorkItem.mockResolvedValue(null)
    runtimeMocks.planeListStates.mockResolvedValue([
      planeState('state-1', 'Todo', 'unstarted', 1),
      planeState('state-2', 'Done', 'completed', 2)
    ])
    runtimeMocks.planeListMembers.mockResolvedValue([planeUser('user-1', 'Alice')])
    runtimeMocks.planeListWorkItemComments.mockResolvedValue([])
    runtimeMocks.planeUpdateWorkItem.mockResolvedValue({ ok: true })
    const user = userEvent.setup()

    await renderWorkspace({ item: planeWorkItem() })

    await waitFor(() => {
      expect(runtimeMocks.planeListStates).toHaveBeenCalled()
    })

    await user.click(screen.getByRole('button', { name: 'Todo' }))
    await user.click(await screen.findByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(runtimeMocks.planeUpdateWorkItem).toHaveBeenCalledWith(
        expect.anything(),
        'proj-1',
        'item-1',
        { stateId: 'state-2' },
        'ws-1'
      )
    })
  })
})
