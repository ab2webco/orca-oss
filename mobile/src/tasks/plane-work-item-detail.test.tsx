import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { PlaneTaskItem } from './plane-mobile-task-list'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ Copy: 'Copy', ExternalLink: 'ExternalLink' }))
vi.mock('../components/TaskProviderLogo', () => ({ TaskProviderLogo: 'TaskProviderLogo' }))

import { PlaneWorkItemDetail } from './plane-work-item-detail'

const URL = 'https://plane.example/orca/browse/ORCA-360/'

function planeItem(url: string): PlaneTaskItem {
  return {
    key: 'plane:ws:item-1',
    provider: 'plane',
    title: 'Plane card opens a detail',
    subtitle: 'ORCA-360 · Orca Lab',
    status: 'In Progress',
    updatedAt: '2026-09-04T10:00:00.000Z',
    source: {
      id: 'item-1',
      identifier: 'ORCA-360',
      title: 'Plane card opens a detail',
      url,
      project: { id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' },
      state: { id: 'state-1', name: 'In Progress', group: 'started' },
      priority: 'high',
      updatedAt: '2026-09-04T10:00:00.000Z'
    }
  }
}

function mount(item: PlaneTaskItem, onOpenInBrowser = vi.fn(), onCopyLink = vi.fn()) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(PlaneWorkItemDetail, { item, onOpenInBrowser, onCopyLink }))
  })
  return { renderer, onOpenInBrowser, onCopyLink }
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('\n')
}

// Why an array, not `| null`: the changed-code gate resolves react-test-renderer types as
// `error` from the root project, and a union with one trips no-redundant-type-constituents.
function pressablesLabelled(renderer: ReactTestRenderer, label: string): ReactTestInstance[] {
  return renderer.root
    .findAllByType('Pressable')
    .filter((node) => node.findAllByType('Text').some((text) => text.children.includes(label)))
}

describe('PlaneWorkItemDetail', () => {
  it('renders identifier, title, state, priority and project read-only', () => {
    const { renderer } = mount(planeItem(URL))
    const text = textOf(renderer)
    expect(text).toContain('Plane card opens a detail')
    expect(text).toContain('ORCA-360')
    expect(text).toContain('In Progress · started')
    expect(text).toContain('High')
    expect(text).toContain('ORCA · Orca Lab')
  })

  it('opens the url only when Open in Plane is pressed', () => {
    const { renderer, onOpenInBrowser, onCopyLink } = mount(planeItem(URL))
    expect(onOpenInBrowser).not.toHaveBeenCalled()
    const [open] = pressablesLabelled(renderer, 'Open in Plane')
    expect(open).toBeDefined()
    act(() => {
      open!.props.onPress()
    })
    expect(onOpenInBrowser).toHaveBeenCalledTimes(1)
    expect(onOpenInBrowser).toHaveBeenCalledWith(URL)
    expect(onCopyLink).not.toHaveBeenCalled()
  })

  it('copies the url when Copy link is pressed', () => {
    const { renderer, onCopyLink } = mount(planeItem(URL))
    const [copy] = pressablesLabelled(renderer, 'Copy link')
    expect(copy).toBeDefined()
    act(() => {
      copy!.props.onPress()
    })
    expect(onCopyLink).toHaveBeenCalledWith(URL)
  })

  it('shows the fields without any open or copy action when the url is empty', () => {
    const { renderer, onOpenInBrowser } = mount(planeItem(''))
    expect(renderer.root.findAllByType('Pressable')).toHaveLength(0)
    expect(pressablesLabelled(renderer, 'Open in Plane')).toHaveLength(0)
    expect(pressablesLabelled(renderer, 'Copy link')).toHaveLength(0)
    expect(onOpenInBrowser).not.toHaveBeenCalled()
    const text = textOf(renderer)
    expect(text).toContain('ORCA-360')
    expect(text).toContain('In Progress · started')
  })
})
