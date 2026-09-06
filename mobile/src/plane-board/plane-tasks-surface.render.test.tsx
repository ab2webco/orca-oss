import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: lucide's circular ESM re-exports do not load under Vite's runner; icons are not under test.
vi.mock('lucide-react-native', async () => {
  const { createElement: h } = await import('react')
  const Icon = () => h('span')
  return new Proxy(
    {},
    {
      get: (_target, name) => (typeof name === 'string' && name !== 'then' ? Icon : undefined),
      has: (_target, name) => typeof name === 'string' && name !== 'then'
    }
  )
})
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
vi.mock(
  '@react-native-async-storage/async-storage',
  () => import('../../test-doubles/async-storage-memory')
)

import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
import {
  byLabel,
  callsTo,
  CARD,
  deviceStorage,
  leafWithText,
  mountBoard,
  openCard,
  PLANE_VIEW_STORAGE_KEY,
  press,
  renderPlaneTasks,
  typeInto
} from '../../test-doubles/plane-tasks-harness'

/** Click the react-native-web button that wraps a leaf text label (used for controls
 *  the underlying component renders without an accessibility label). */
async function pressTextButton(text: string): Promise<void> {
  const leaf = leafWithText(text)
  const button = leaf?.closest<HTMLElement>('[role="button"]')
  if (!button) {
    throw new Error(`no button for text ${text}`)
  }
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

const WRITING_HOST = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]

describe('Plane on the Tasks screen: one screen, two views, one detail (react-native-web)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    deviceStorage.entries.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  describe('view mode', () => {
    it('shows the board in place when "Show as board" is pressed: same screen, no route', async () => {
      const calls = await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      // The list is what is on screen: rows, no columns, and nothing read for a board.
      expect(byLabel('Row Wire the retry')).not.toBeNull()
      expect(byLabel('Todo, 1 cards')).toBeNull()
      expect(byLabel('Show as list')?.getAttribute('aria-selected')).toBe('true')
      expect(callsTo(calls, 'plane.listStates')).toHaveLength(0)

      await press('Show as board')

      expect(byLabel('Show as board')?.getAttribute('aria-selected')).toBe('true')
      expect(byLabel('Todo, 1 cards')).not.toBeNull()
      expect(byLabel('Doing, 0 cards')).not.toBeNull()
      expect(byLabel('Wire the retry')).not.toBeNull()
      expect(callsTo(calls, 'plane.listWorkItems')[0]?.params).toMatchObject({
        projectId: 'proj-1',
        workspaceId: 'ws-1',
        filter: 'all'
      })
    })

    it('remembers the chosen view on this device across a remount', async () => {
      await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      await press('Show as board')
      expect(deviceStorage.entries.get(PLANE_VIEW_STORAGE_KEY)).toBe(
        JSON.stringify({ viewMode: 'board' })
      )

      act(() => root.unmount())
      root = createRoot(container)
      await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})

      expect(byLabel('Show as board')?.getAttribute('aria-selected')).toBe('true')
      expect(byLabel('Todo, 1 cards')).not.toBeNull()
      expect(byLabel('Row Wire the retry')).toBeNull()
    })

    it('goes back to the list, and the list is the default a fresh device starts on', async () => {
      await mountBoard(root, WRITING_HOST, { items: [CARD] })
      expect(byLabel('Todo, 1 cards')).not.toBeNull()

      await press('Show as list')

      expect(byLabel('Row Wire the retry')).not.toBeNull()
      expect(byLabel('Todo, 1 cards')).toBeNull()
      // The default is not pinned: a reset clears the key instead of storing "list".
      expect(deviceStorage.entries.has(PLANE_VIEW_STORAGE_KEY)).toBe(false)
    })

    it('ignores junk left in device storage and starts on the list', async () => {
      deviceStorage.entries.set(PLANE_VIEW_STORAGE_KEY, '{"viewMode":"kanban"}')
      await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})

      expect(byLabel('Show as list')?.getAttribute('aria-selected')).toBe('true')
      expect(byLabel('Row Wire the retry')).not.toBeNull()
    })

    it('keeps the state chip for the list only: the board’s columns are its state filter', async () => {
      await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      expect(leafWithText('All states')).not.toBeNull()

      await press('Show as board')
      expect(leafWithText('All states')).toBeNull()
    })
  })

  describe('one detail from both views', () => {
    it('opens the full detail from a list row: move, priority and comments, not a read-only card', async () => {
      const calls = await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      await press('Row Wire the retry')

      expect(byLabel('Move to Doing')).not.toBeNull()
      expect(byLabel('Priority High')).not.toBeNull()
      expect(byLabel('Post comment')).not.toBeNull()
      // The detail read its card's project so "Move to" and live edits have columns to work on.
      expect(callsTo(calls, 'plane.listStates')).toEqual([
        { method: 'plane.listStates', params: { projectId: 'proj-1', workspaceId: 'ws-1' } }
      ])
    })

    it('reads the open card’s own project in list mode even under "All projects"', async () => {
      const calls = await renderPlaneTasks(
        root,
        WRITING_HOST,
        { items: [CARD] },
        { projectId: null }
      )
      expect(callsTo(calls, 'plane.listStates')).toHaveLength(0)

      await press('Row Wire the retry')

      expect(callsTo(calls, 'plane.listStates')[0]?.params).toMatchObject({ projectId: 'proj-1' })
      expect(byLabel('Move to Doing')).not.toBeNull()
    })

    it('sets the priority from a list row’s detail and shows it there at once', async () => {
      const calls = await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      await press('Row Wire the retry')
      await press('Priority High')

      expect(callsTo(calls, 'plane.updateWorkItem')[0]?.params).toMatchObject({
        workItemId: 'wi-1',
        updates: { priority: 'high' }
      })
      expect(byLabel('Priority High')?.getAttribute('aria-selected')).toBe('true')
    })

    it('opens the same detail from a board card', async () => {
      await mountBoard(root, WRITING_HOST, { items: [CARD] })
      await openCard()

      expect(byLabel('Move to Doing')).not.toBeNull()
      expect(byLabel('Priority High')).not.toBeNull()
      expect(byLabel('Post comment')).not.toBeNull()
    })
  })

  describe('board scope follows the Tasks screen', () => {
    it('keeps a failed edit and its retry with its project, not on the next project opened', async () => {
      const calls = await mountBoard(root, WRITING_HOST, {
        rejectWrites: new Error('Connection interrupted'),
        items: [CARD]
      })
      await openCard()
      await press('Priority High')
      await press('Close detail')
      const banner = 'Could not update the card — Connection interrupted'
      expect(leafWithText(banner)).not.toBeNull()

      await press('Switch project')
      expect(leafWithText('Ab2Web has no work items')).not.toBeNull()
      // The control for the unfixed board: the banner and "Try again" for a card of
      // Orca Lab stayed on Ab2Web's board, and the retry resent that card's patch.
      expect(leafWithText(banner)).toBeNull()
      expect(byLabel('Try again')).toBeNull()
      expect(byLabel('Wire the retry')).toBeNull()

      await press('Switch project')
      expect(byLabel('Wire the retry')).not.toBeNull()
      expect(leafWithText(banner)).not.toBeNull()
      await press('Try again')
      expect(callsTo(calls, 'plane.updateWorkItem')).toHaveLength(2)
      expect(callsTo(calls, 'plane.updateWorkItem')[1]?.params).toMatchObject({
        workItemId: 'wi-1',
        updates: { priority: 'high' }
      })
    })

    it('keeps a failed move with its project as well', async () => {
      await mountBoard(root, WRITING_HOST, {
        rejectWrites: new Error('Connection interrupted'),
        items: [CARD]
      })
      await openCard()
      await press('Move to Doing')
      const banner = 'Could not move the card — Connection interrupted'
      expect(leafWithText(banner)).not.toBeNull()

      await press('Switch project')
      expect(leafWithText(banner)).toBeNull()

      await press('Switch project')
      expect(leafWithText(banner)).not.toBeNull()
    })

    it('asks for a project when none is picked, and the action opens the Tasks project picker', async () => {
      const calls = await mountBoard(root, WRITING_HOST, { items: [CARD] }, { projectId: null })

      expect(leafWithText('Pick a project')).not.toBeNull()
      expect(callsTo(calls, 'plane.listStates')).toHaveLength(0)
      expect(byLabel('Add card')).toBeNull()

      await press('Choose project')
      expect(leafWithText('Project picker')).not.toBeNull()
    })

    it('reads the board with the list’s search, and blames the filter when it hides every card', async () => {
      const calls = await mountBoard(root, WRITING_HOST, { items: [] }, { query: 'nothing' })
      // A search reads through plane.searchWorkItems, the same call the list makes.
      expect(callsTo(calls, 'plane.searchWorkItems')[0]?.params).toMatchObject({
        query: 'nothing',
        projectId: 'proj-1'
      })
      expect(callsTo(calls, 'plane.listWorkItems')).toHaveLength(0)
      expect(leafWithText('No cards match the filter')).not.toBeNull()
      expect(leafWithText('Orca Lab has no work items')).toBeNull()

      await press('Clear filter')
      expect(callsTo(calls, 'plane.listWorkItems')).toHaveLength(1)
      expect(leafWithText('Orca Lab has no work items')).not.toBeNull()
    })
  })

  describe('list-mode detail: writes are visible and reversible', () => {
    const LINKED = { ...CARD, url: 'https://plane.example/wi-1' }
    const MOVE_DROPPED = 'Could not move the card — Connection interrupted'

    it('keeps the list-row detail open and shows the error when a move is dropped', async () => {
      // Blocker 1: closing before the move raced the list re-read ahead of the write, so a
      // failure had nowhere to show (PlaneBoardView is not mounted in list mode).
      const calls = await renderPlaneTasks(
        root,
        WRITING_HOST,
        { items: [CARD], rejectWrites: new Error('Connection interrupted') },
        {}
      )
      await press('Row Wire the retry')
      await press('Move to Doing')

      expect(leafWithText(MOVE_DROPPED)).not.toBeNull()
      expect(byLabel('Move to Doing')).not.toBeNull()
      expect(callsTo(calls, 'plane.updateWorkItem')).toHaveLength(1)
    })

    it('closes the list-row detail only after the move actually succeeds', async () => {
      const calls = await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      await press('Row Wire the retry')
      expect(byLabel('Move to Doing')).not.toBeNull()

      await press('Move to Doing')

      expect(callsTo(calls, 'plane.updateWorkItem')).toHaveLength(1)
      expect(byLabel('Move to Doing')).toBeNull()
    })

    it('says the board is loading, not "one column", while it reads on card open', async () => {
      // Blocker 3: columns are empty during the read; the note must wait for status ready.
      await renderPlaneTasks(root, WRITING_HOST, { items: [CARD], hangReads: true }, {})
      await press('Row Wire the retry')

      expect(leafWithText('Loading the board…')).not.toBeNull()
      expect(
        leafWithText('This project has only one column, so there is nowhere to move this card.')
      ).toBeNull()
    })

    it('surfaces a board read failure in the list-row detail with a retry', async () => {
      await renderPlaneTasks(
        root,
        WRITING_HOST,
        { items: [CARD], failReads: new Error('read failed') },
        {}
      )
      await press('Row Wire the retry')

      expect(leafWithText('read failed')).not.toBeNull()
      expect(byLabel('Retry loading the board')).not.toBeNull()
    })

    it('offers Copy link in the detail for Plane and reports it copied', async () => {
      // Blocker 4: the sheet dropped onCopyLink, so Plane lost the action GitHub/Linear keep.
      await renderPlaneTasks(root, WRITING_HOST, { items: [LINKED] }, {})
      await press('Row Wire the retry')

      expect(leafWithText('Copy link')).not.toBeNull()
      await pressTextButton('Copy link')
      expect(leafWithText('Copied')).not.toBeNull()
    })

    it('keeps a failed comment draft across a relay disconnect and reconnect', async () => {
      // Blocker 2: enabled drops on a relay blip; the reset used to wipe the failed draft.
      await renderPlaneTasks(
        root,
        WRITING_HOST,
        { items: [CARD], rejectWrites: new Error('Connection interrupted') },
        {}
      )
      await press('Row Wire the retry')
      const input = byLabel('Comment')
      if (!(input instanceof HTMLTextAreaElement)) {
        throw new Error('comment input is not mounted')
      }
      typeInto(input, 'Looks good')
      await press('Post comment')
      expect(leafWithText('Could not post the comment — Connection interrupted')).not.toBeNull()

      await press('Toggle connection')
      await press('Toggle connection')

      expect(leafWithText('Could not post the comment — Connection interrupted')).not.toBeNull()
      const reopened = byLabel('Comment')
      if (!(reopened instanceof HTMLTextAreaElement)) {
        throw new Error('comment input did not come back')
      }
      expect(reopened.value).toBe('Looks good')
    })

    it('closes the detail while disconnected and reopens it on reconnect', async () => {
      // Guard: openItem = enabled ? detailItem : null — no sheet over a board that cannot read.
      await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})
      await press('Row Wire the retry')
      expect(byLabel('Move to Doing')).not.toBeNull()

      await press('Toggle connection')
      expect(byLabel('Move to Doing')).toBeNull()

      await press('Toggle connection')
      expect(byLabel('Move to Doing')).not.toBeNull()
    })
  })
})
