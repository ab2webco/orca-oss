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
  MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
} from './plane-board-writes-capability'
import {
  CARD,
  callsTo,
  deviceStorage,
  mountBoard as mountBoardWith,
  type HostBehaviour
} from '../../test-doubles/plane-tasks-harness'
import {
  byLabel,
  leafWithText,
  openCard,
  press,
  typeInto
} from '../../test-doubles/plane-tasks-screen-driver'

const ASSIGNING_HOST = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY,
  MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY
]

const ADA = { id: 'u-1', displayName: 'Ada' }

/** More members than fit on a phone screen; Ada keeps her id so the fixture card can assign her. */
function members(count: number): { id: string; displayName: string }[] {
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? ADA
      : { id: `u-${index + 1}`, displayName: `Member ${String(index + 1).padStart(2, '0')}` }
  )
}

const CARD_WITH_ADA = { ...CARD, assignees: [ADA] }

function assigneeButtons(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="button"]')).filter((el) =>
    /^(Assign|Unassign) /.test(el.getAttribute('aria-label') ?? '')
  )
}

function searchInput(): HTMLInputElement {
  const input = byLabel('Search members')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('member search input is not mounted')
  }
  return input
}

describe('Plane assignee picker sheet (react-native-web)', () => {
  let container: HTMLDivElement
  let root: Root

  function mountFresh(): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }

  beforeEach(() => {
    deviceStorage.entries.clear()
    mountFresh()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const mountBoard = (behaviour: HostBehaviour = {}) =>
    mountBoardWith(root, ASSIGNING_HOST, behaviour)

  it('keeps the detail the same size whether the project has 3 members or 25', async () => {
    await mountBoard({ items: [CARD_WITH_ADA], members: members(3) })
    await openCard()
    const buttonsWithThree = document.body.querySelectorAll('[role="button"]').length
    expect(byLabel('Edit assignees')).not.toBeNull()

    act(() => root.unmount())
    container.remove()
    mountFresh()

    await mountBoard({ items: [CARD_WITH_ADA], members: members(25) })
    await openCard()
    expect(document.body.querySelectorAll('[role="button"]').length).toBe(buttonsWithThree)
    expect(assigneeButtons()).toHaveLength(0)
    expect(byLabel('Assign Member 07')).toBeNull()
    expect(byLabel('Edit assignees')).not.toBeNull()
  })

  it('summarises the assigned members as chips and offers Add when nobody is assigned', async () => {
    await mountBoard({ items: [{ ...CARD, assignees: [] }], members: members(3) })
    await openCard()

    expect(leafWithText('Nobody assigned')).not.toBeNull()
    expect(byLabel('Edit assignees')?.textContent).toBe('Add')

    await press('Edit assignees')
    await press('Assign Ada')
    expect(leafWithText('Nobody assigned')).toBeNull()
    expect(byLabel('Edit assignees')?.textContent).toBe('Edit')
  })

  it('lists every member in the picker, assigned first, and narrows on search', async () => {
    await mountBoard({ items: [CARD_WITH_ADA], members: members(25) })
    await openCard()
    await press('Edit assignees')

    const rows = assigneeButtons()
    expect(rows).toHaveLength(25)
    expect(rows[0]?.getAttribute('aria-label')).toBe('Unassign Ada')
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true')
    expect(rows[1]?.getAttribute('aria-label')).toBe('Assign Member 02')

    typeInto(searchInput(), 'member 2')
    const expected = members(25)
      .map((member) => member.displayName)
      .filter((name) => name.toLowerCase().includes('member 2'))
    expect(expected).toHaveLength(6)
    expect(assigneeButtons().map((el) => el.getAttribute('aria-label'))).toEqual(
      expected.map((name) => `Assign ${name}`)
    )

    typeInto(searchInput(), 'nobody')
    expect(assigneeButtons()).toHaveLength(0)
    expect(leafWithText('No members match')).not.toBeNull()

    typeInto(searchInput(), '')
    expect(assigneeButtons()).toHaveLength(25)
  })

  it('writes the whole assignee list on toggle and flips the row without closing the sheet', async () => {
    const calls = await mountBoard({ items: [CARD_WITH_ADA] })
    await openCard()
    await press('Edit assignees')
    await press('Assign Grace')

    expect(callsTo(calls, 'plane.updateWorkItem')[0]?.params).toEqual({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workspaceId: 'ws-1',
      updates: { assigneeIds: ['u-1', 'u-2'] }
    })
    expect(byLabel('Unassign Grace')).not.toBeNull()
    expect(byLabel('Unassign Grace')?.getAttribute('aria-checked')).toBe('true')
    expect(byLabel('Search members')).not.toBeNull()
  })
})
