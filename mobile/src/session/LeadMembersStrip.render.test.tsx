import { act, createElement } from 'react'
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

import { LeadMembersStrip } from './LeadMembersStrip'
import type { LeadMember } from './lead-members'

const MEMBERS: LeadMember[] = [
  { worktreeId: 'wt-a', tabId: 'tab-a', label: 'ORCA-611 host', state: 'working' },
  { worktreeId: 'wt-b', tabId: 'tab-b', label: 'orca-611-b', state: 'done' }
]

describe('LeadMembersStrip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('lists each member as a tap target that opens it', () => {
    const onOpen = vi.fn()
    act(() => root.render(createElement(LeadMembersStrip, { members: MEMBERS, onOpen })))

    const buttons = [...container.querySelectorAll<HTMLElement>('[role="button"]')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open member ORCA-611 host',
      'Open member orca-611-b'
    ])
    act(() => buttons[1]!.click())
    expect(onOpen).toHaveBeenCalledWith(MEMBERS[1])
  })

  it('renders nothing for a terminal that leads no one', () => {
    act(() => root.render(createElement(LeadMembersStrip, { members: [], onOpen: vi.fn() })))
    expect(container.innerHTML).toBe('')
  })
})
