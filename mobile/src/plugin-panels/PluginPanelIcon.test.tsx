import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginPanelIconSvgNode } from '../../../src/shared/plugins/plugin-panel-icon-svg'
import { PluginPanelIcon } from './PluginPanelIcon'

vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  BarChart3: 'BarChart3',
  Bell: 'Bell',
  Blocks: 'Blocks',
  Book: 'Book',
  Bot: 'Bot',
  Bug: 'Bug',
  Calendar: 'Calendar',
  Cloud: 'Cloud',
  Code: 'Code',
  Database: 'Database',
  FileText: 'FileText',
  Flag: 'Flag',
  Folder: 'Folder',
  Gauge: 'Gauge',
  Globe: 'Globe',
  Hammer: 'Hammer',
  Inbox: 'Inbox',
  Layers: 'Layers',
  Lightbulb: 'Lightbulb',
  Mail: 'Mail',
  MessageCircle: 'MessageCircle',
  MessageSquare: 'MessageSquare',
  Package: 'Package',
  Plug: 'Plug',
  Puzzle: 'Puzzle',
  Rocket: 'Rocket',
  Star: 'Star',
  Terminal: 'Terminal',
  Users: 'Users',
  Wrench: 'Wrench',
  Zap: 'Zap'
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Ellipse: 'Ellipse',
  G: 'G',
  Line: 'Line',
  Path: 'Path',
  Polygon: 'Polygon',
  Polyline: 'Polyline',
  Rect: 'Rect'
}))

describe('PluginPanelIcon', () => {
  // Why: a `| null` union over this type trips no-redundant-type-constituents in the root lint.
  let mounted: ReactTestRenderer[] = []
  const latest = () => mounted.at(-1)!

  afterEach(() => {
    act(() => mounted.forEach((view) => view.unmount()))
    mounted = []
  })

  function render(props: { icon?: string; iconSvg?: PluginPanelIconSvgNode }) {
    act(() => {
      mounted.push(
        create(
          createElement(PluginPanelIcon, {
            ...props,
            size: 20,
            color: '#abcdef'
          })
        )
      )
    })
    return latest().toJSON() as {
      type: string
      props: Record<string, unknown>
    }
  }

  it('resolves a curated icon name with the given size and color', () => {
    const icon = render({ icon: 'inbox' })
    expect(icon.type).toBe('Inbox')
    expect(icon.props).toMatchObject({ size: 20, color: '#abcdef' })
  })

  it('accepts dashed and PascalCase lucide names', () => {
    expect(render({ icon: 'file-text' }).type).toBe('FileText')
    expect(render({ icon: 'MessageSquare' }).type).toBe('MessageSquare')
    expect(render({ icon: 'bar-chart-3' }).type).toBe('BarChart3')
  })

  it('falls back to Plug for a missing, unknown or inherited name', () => {
    expect(render({}).type).toBe('Plug')
    expect(render({ icon: 'not-an-icon' }).type).toBe('Plug')
    expect(render({ icon: 'icons/board.svg' }).type).toBe('Plug')
    expect(render({ icon: 'constructor' }).type).toBe('Plug')
    expect(render({ icon: '__proto__' }).type).toBe('Plug')
  })

  it('paints a custom svg tree over the icon name, bound to the given color', () => {
    const iconSvg: PluginPanelIconSvgNode = {
      tag: 'svg',
      attributes: { viewBox: '0 0 24 24', fill: 'currentColor' },
      children: [
        {
          tag: 'g',
          attributes: {
            stroke: 'currentColor',
            'stroke-width': '2',
            'fill-rule': 'evenodd'
          },
          children: [
            { tag: 'path', attributes: { d: 'M0 0h24' }, children: [] },
            {
              tag: 'circle',
              attributes: { cx: '12', cy: '12', r: '4' },
              children: []
            }
          ]
        },
        {
          tag: 'rect',
          attributes: { width: '4', height: '4', fill: 'none' },
          children: []
        }
      ]
    }
    const icon = render({ icon: 'inbox', iconSvg }) as unknown as SvgJson

    expect(icon.type).toBe('Svg')
    expect(icon.props).toMatchObject({
      width: 20,
      height: 20,
      viewBox: '0 0 24 24',
      fill: '#abcdef',
      color: '#abcdef'
    })
    const [group, rect] = icon.children
    expect(group?.type).toBe('G')
    expect(group?.props).toMatchObject({
      stroke: '#abcdef',
      strokeWidth: '2',
      fillRule: 'evenodd'
    })
    expect(group?.props).not.toHaveProperty('stroke-width')
    expect(group?.children.map((child) => child.type)).toEqual(['Path', 'Circle'])
    expect(group?.children[0]?.props).toMatchObject({ d: 'M0 0h24' })
    expect(rect?.type).toBe('Rect')
    expect(rect?.props).toMatchObject({
      width: '4',
      height: '4',
      fill: 'none'
    })
  })
})

type SvgJson = {
  type: string
  props: Record<string, unknown>
  children: SvgJson[]
}
