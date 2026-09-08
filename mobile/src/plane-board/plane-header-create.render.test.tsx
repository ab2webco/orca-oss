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
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
import {
  CARD,
  callsTo,
  deviceStorage,
  renderPlaneTasks
} from '../../test-doubles/plane-tasks-harness'
import {
  byLabel,
  leafWithText,
  press,
  typeInto
} from '../../test-doubles/plane-tasks-screen-driver'

const WRITING_HOST = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]

const CREATED_CARD = { ...CARD, id: 'wi-9', identifier: 'ORCA-9', title: 'Fix the relay' }

function titleInput(): HTMLInputElement {
  const input = byLabel('Work item title')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('no title input')
  }
  return input
}

describe('Plane header +: the create sheet (ORCA-463, react-native-web)', () => {
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

  it('the + is there and opens the sheet in list mode', async () => {
    await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, {})

    expect(byLabel('New work item')).not.toBeNull()
    await press('New work item')

    expect(byLabel('Work item title')).not.toBeNull()
    expect(leafWithText('New Plane Work Item')).not.toBeNull()
  })

  it('create sends the minimum and opens the card', async () => {
    const calls = await renderPlaneTasks(
      root,
      WRITING_HOST,
      { items: [CARD], itemsAfterWrite: [CARD, CREATED_CARD] },
      {}
    )
    await press('New work item')
    typeInto(titleInput(), 'Fix the relay')
    await press('Create work item')

    expect(callsTo(calls, 'plane.createWorkItem')[0]?.params).toMatchObject({
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      title: 'Fix the relay',
      stateId: 'state-1'
    })
    expect(byLabel('Work item title')).toBeNull()
    expect(byLabel('Move to Doing')).not.toBeNull()
    expect(leafWithText('Fix the relay')).not.toBeNull()
  })

  it('a refused create stays on the sheet with the title', async () => {
    await renderPlaneTasks(
      root,
      WRITING_HOST,
      { items: [CARD], rejectWrites: new Error('Connection interrupted') },
      {}
    )
    await press('New work item')
    typeInto(titleInput(), 'Fix the relay')
    await press('Create work item')

    expect(byLabel('Work item title')).not.toBeNull()
    expect(byLabel('Create error')).not.toBeNull()
    expect(byLabel('Create error')?.textContent).toContain('Connection interrupted')
    expect(titleInput().value).toBe('Fix the relay')
    expect(byLabel('Move to Doing')).toBeNull()
  })

  it('treats an unanswered create as done when the re-read shows the card: no second card', async () => {
    const calls = await renderPlaneTasks(
      root,
      WRITING_HOST,
      {
        items: [CARD],
        rejectWrites: markRpcDeliveryUnknown(new Error('Request timed out: plane.createWorkItem')),
        itemsAfterWrite: [CARD, CREATED_CARD]
      },
      {}
    )
    await press('New work item')
    typeInto(titleInput(), 'Fix the relay')
    await press('Create work item')

    expect(callsTo(calls, 'plane.createWorkItem')).toHaveLength(1)
    expect(byLabel('Create error')).toBeNull()
    expect(byLabel('Work item title')).toBeNull()
    expect(byLabel('Move to Doing')).not.toBeNull()
  })

  it('reads the project states itself when the screen has none yet: no empty stateId', async () => {
    const calls = await renderPlaneTasks(
      root,
      WRITING_HOST,
      { items: [CARD], itemsAfterWrite: [CARD, CREATED_CARD] },
      { defaultState: null }
    )
    await press('New work item')
    typeInto(titleInput(), 'Fix the relay')
    await press('Create work item')

    expect(callsTo(calls, 'plane.listStates').length).toBeGreaterThanOrEqual(1)
    expect(callsTo(calls, 'plane.createWorkItem')[0]?.params).toMatchObject({ stateId: 'state-1' })
    expect(byLabel('Create error')).toBeNull()
    expect(byLabel('Move to Doing')).not.toBeNull()
  })

  it('no project: the + opens the project picker, not the sheet', async () => {
    await renderPlaneTasks(root, WRITING_HOST, { items: [CARD] }, { projectId: null })
    await press('New work item')

    expect(leafWithText('Project picker')).not.toBeNull()
    expect(byLabel('Work item title')).toBeNull()
  })
})
