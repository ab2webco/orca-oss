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
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
import { CARD, PROJECT, deviceStorage, mountBoard } from '../../test-doubles/plane-tasks-harness'
import { byLabel, cardText, press } from '../../test-doubles/plane-tasks-screen-driver'

const WRITING_HOST = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]

const FACTS_CARD = {
  ...CARD,
  project: PROJECT,
  priority: 'high',
  assignees: [{ id: 'u-1', displayName: 'Ana' }],
  updatedAt: '2026-09-01T10:00:00.000Z'
}

describe('Plane display properties: the sheet decides what a card says (react-native-web)', () => {
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

  it('starts with every Plane property on: identifier, project, priority, assignee and the pill', async () => {
    await mountBoard(root, WRITING_HOST, { items: [FACTS_CARD] })

    const text = cardText('Wire the retry')
    expect(text).toContain('ORCA-1')
    expect(text).toContain('Orca Lab')
    expect(text).toContain('High')
    expect(text).toContain('Ana')
    expect(byLabel('Move from Todo')).not.toBeNull()
  })

  it('drops a fact from the card when its row is unchecked, and brings it back on recheck', async () => {
    await mountBoard(root, WRITING_HOST, { items: [FACTS_CARD] })

    await press('Display properties')
    await press('Show Priority')
    expect(cardText('Wire the retry')).not.toContain('High')
    expect(cardText('Wire the retry')).toContain('Ana')

    await press('Show Assignee')
    expect(cardText('Wire the retry')).not.toContain('Ana')

    await press('Show Status')
    expect(byLabel('Move from Todo')).toBeNull()

    await press('Show Project')
    expect(cardText('Wire the retry')).not.toContain('Orca Lab')
    expect(cardText('Wire the retry')).toContain('ORCA-1')

    await press('Show Priority')
    expect(cardText('Wire the retry')).toContain('High')
  })
})
