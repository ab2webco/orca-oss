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
// Why: react-native-webview ships untranspiled native source; the sheet's markdown renders no diagram here.
vi.mock('react-native-webview', () => ({ WebView: () => null }))
vi.mock(
  '@react-native-async-storage/async-storage',
  () => import('../../test-doubles/async-storage-memory')
)

import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import {
  MOBILE_PLANE_BOARD_COLUMNS_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
} from './plane-board-writes-capability'
import {
  CARD,
  callsTo,
  deviceStorage,
  mountBoard,
  type HostBehaviour
} from '../../test-doubles/plane-tasks-harness'
import {
  boardColumn,
  byLabel,
  leafWithText,
  press,
  settle,
  typeInto
} from '../../test-doubles/plane-tasks-screen-driver'

const WRITING_HOST = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]

/** A host that also advertises column edits: the only one that shows the column menu. */
export const COLUMNS_HOST = [...WRITING_HOST, MOBILE_PLANE_BOARD_COLUMNS_CAPABILITY]

const TODO = { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 }
const DOING = { id: 'state-2', name: 'Doing', group: 'started', sequence: 2 }

/** The newest control with this label: the drawer opened last, when two are mounted. */
function lastByLabel(label: string): HTMLElement | null {
  const all = document.body.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)
  return all[all.length - 1] ?? null
}

async function pressLast(label: string): Promise<void> {
  await act(async () => {
    lastByLabel(label)?.click()
    await Promise.resolve()
  })
  await settle()
}

function nameInput(): HTMLInputElement {
  const input = lastByLabel('Column name')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('no column name input')
  }
  return input
}

describe('Plane board column menu: rename (ORCA-426, react-native-web)', () => {
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

  const mount = (capabilities: readonly string[], behaviour: HostBehaviour = {}) =>
    mountBoard(root, capabilities, { items: [CARD], ...behaviour })

  it('a host without columns.v1 shows no column controls, even with writes.v1', async () => {
    await mount(WRITING_HOST)

    expect(boardColumn('Todo')).toEqual({ count: 1 })
    expect(byLabel('Column actions for Todo')).toBeNull()
    expect(byLabel('Column actions for Doing')).toBeNull()
  })

  it('rename persists and shows without a refresh', async () => {
    const calls = await mount(COLUMNS_HOST, {
      statesAfterWrite: [{ ...TODO, name: 'Backlog!' }, DOING]
    })
    const statesReadsBefore = callsTo(calls, 'plane.listStates').length

    await press('Column actions for Todo')
    expect(leafWithText('Todo')).not.toBeNull()
    await press('Rename column')
    expect(nameInput().value).toBe('Todo')
    typeInto(nameInput(), 'Backlog!')
    await press('Save column name')

    expect(callsTo(calls, 'plane.updateState').map((call) => call.params)).toEqual([
      { projectId: 'proj-1', workspaceId: 'ws-1', stateId: 'state-1', name: 'Backlog!' }
    ])
    expect(callsTo(calls, 'plane.listStates').length).toBeGreaterThan(statesReadsBefore)
    expect(boardColumn('Backlog!')).toEqual({ count: 1 })
    expect(boardColumn('Todo')).toBeNull()
    // The drawer closed on success.
    expect(byLabel('Column name')).toBeNull()
    expect(byLabel('Column error')).toBeNull()
  })

  it('a rename that lands but cannot be re-read says so and keeps the old name', async () => {
    await mount(COLUMNS_HOST, { failReadsAfterWrite: new Error('Socket closed') })

    await press('Column actions for Todo')
    await press('Rename column')
    typeInto(nameInput(), 'Backlog!')
    await press('Save column name')

    expect(byLabel('Column name')).toBeNull()
    expect(document.body.textContent).toContain('Renamed, but the board could not be re-read')
    expect(boardColumn('Todo')).toEqual({ count: 1 })
    expect(boardColumn('Backlog!')).toBeNull()
  })

  it('a rejected write keeps the column and says so', async () => {
    const calls = await mount(COLUMNS_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      statesAfterWrite: [{ ...TODO, name: 'Backlog!' }, DOING]
    })

    await press('Column actions for Todo')
    await press('Rename column')
    typeInto(nameInput(), 'Backlog!')
    await press('Save column name')

    expect(byLabel('Column error')).not.toBeNull()
    expect(byLabel('Column error')?.textContent).toContain('Connection interrupted')
    // The typed name survives for the retry; nothing was resent on its own.
    expect(nameInput().value).toBe('Backlog!')
    expect(callsTo(calls, 'plane.updateState')).toHaveLength(1)
    expect(boardColumn('Todo')).toEqual({ count: 1 })
    expect(boardColumn('Backlog!')).toBeNull()
  })

  it('a failed rename on one column keeps its error after another column renames fine', async () => {
    await mount(COLUMNS_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      rejectWritesFor: 'state-1',
      statesAfterWrite: [TODO, { ...DOING, name: 'Done!' }]
    })
    await press('Column actions for Todo')
    await press('Rename column')
    typeInto(nameInput(), 'Backlog!')
    await press('Save column name')

    // Todo's drawer stays open; Doing's menu is reached behind it.
    await press('Column actions for Doing')
    await pressLast('Rename column')
    typeInto(nameInput(), 'Done!')
    await pressLast('Save column name')

    expect(boardColumn('Done!')).toEqual({ count: 0 })
    expect(document.body.textContent).toContain('the column — Connection interrupted')
    expect(byLabel('Column error')?.textContent).toContain('Connection interrupted')
  })

  it('a blank name never reaches the host', async () => {
    const calls = await mount(COLUMNS_HOST)

    await press('Column actions for Todo')
    await press('Rename column')
    typeInto(nameInput(), '   ')
    await press('Save column name')

    expect(callsTo(calls, 'plane.updateState')).toEqual([])
    expect(byLabel('Column name')).not.toBeNull()
    expect(boardColumn('Todo')).toEqual({ count: 1 })
  })
})
