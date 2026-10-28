import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_TOUCH_TARGET } from '../theme/mobile-theme'
import { HostListToolbar, type HostListToolbarProps } from './HostListToolbar'
import { WorkspaceSectionHeader } from './WorkspaceSectionHeader'
import { WorktreeListRow, type WorktreeListRowItem } from './WorktreeListRow'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Rect: 'Rect',
  Stop: 'Stop'
}))
vi.mock('lucide-react-native', () => ({
  Bell: 'Bell',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Filter: 'Filter',
  GitBranch: 'GitBranch',
  GitPullRequest: 'GitPullRequest',
  Layers: 'Layers',
  List: 'List',
  Pin: 'Pin',
  Search: 'Search',
  SlidersHorizontal: 'SlidersHorizontal',
  UserCircle: 'UserCircle',
  X: 'X'
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('./AgentSpinner', () => ({ AgentSpinner: 'AgentSpinner' }))
vi.mock('./MobileRepoIcon', () => ({ MobileRepoIcon: 'MobileRepoIcon' }))
vi.mock('./WorktreeAgentList', () => ({ WorktreeAgentList: 'WorktreeAgentList' }))
vi.mock('./WorktreeMetaGlyphs', () => ({
  WorktreeMetaGlyphs: 'WorktreeMetaGlyphs',
  prStateColor: () => '#000'
}))

type FlatStyle = Record<string, unknown>
type Insets = { top: number; bottom: number; left: number; right: number }

function flattenStyle(style: unknown): FlatStyle {
  if (typeof style === 'function') {
    return flattenStyle(style({ pressed: false }))
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle))
  }
  return style && typeof style === 'object' ? (style as FlatStyle) : {}
}

function hitSlopInsets(hitSlop: unknown): Insets {
  if (typeof hitSlop === 'number') {
    return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }
  }
  const slop = (hitSlop ?? {}) as Partial<Insets>
  return {
    top: slop.top ?? 0,
    bottom: slop.bottom ?? 0,
    left: slop.left ?? 0,
    right: slop.right ?? 0
  }
}

function dimension(style: FlatStyle, min: string, exact: string): number {
  const value = style[min] ?? style[exact]
  return typeof value === 'number' ? value : 0
}

// Effective target from declared minimums plus hitSlop; content-sized widths count as unknown (0).
function effectiveTarget(node: ReactTestInstance): { width: number; height: number } {
  const style = flattenStyle(node.props.style)
  const slop = hitSlopInsets(node.props.hitSlop)
  return {
    width: dimension(style, 'minWidth', 'width') + slop.left + slop.right,
    height: dimension(style, 'minHeight', 'height') + slop.top + slop.bottom
  }
}

function pressableByLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)
}

// Why: holding the renderer in a `| null` union trips the root type-aware lint, which cannot resolve its type.
const unmounts: (() => void)[] = []

function render(element: ReactElement): ReactTestInstance {
  let readRoot!: () => ReactTestInstance
  act(() => {
    const renderer = create(element)
    unmounts.push(() => renderer.unmount())
    readRoot = () => renderer.root
  })
  return readRoot()
}

afterEach(() => {
  act(() => unmounts.splice(0).forEach((unmount) => unmount()))
})

const toolbarProps: HostListToolbarProps = {
  activeFilterCount: 0,
  sortLabel: 'Agent activity',
  groupLabel: 'Repo',
  connected: true,
  showSearch: false,
  onOpenFilter: () => {},
  onOpenSort: () => {},
  onOpenGroup: () => {},
  onOpenAccounts: () => {},
  onOpenTasks: () => {},
  onToggleSearch: () => {}
}

describe('host list toolbar touch targets', () => {
  it.each(['Accounts', 'Tasks', 'Search workspaces'])('%s icon is at least 44x44', (label) => {
    const root = render(createElement(HostListToolbar, toolbarProps))
    const target = effectiveTarget(pressableByLabel(root, label))
    expect(target.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    expect(target.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })

  it.each(['Filter', 'Sort by Agent activity', 'Group by Repo'])(
    '%s chip is at least 44 tall and wide',
    (label) => {
      const root = render(createElement(HostListToolbar, toolbarProps))
      const target = effectiveTarget(pressableByLabel(root, label))
      expect(target.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(target.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
  )

  it('keeps chip labels whole instead of truncating them', () => {
    const root = render(createElement(HostListToolbar, toolbarProps))
    const labels = root.findAllByType('Text')
    expect(labels.map((node) => node.props.numberOfLines)).not.toContain(1)
    expect(labels.flatMap((node) => node.children)).toEqual(
      expect.arrayContaining(['Filter', 'Agent activity', 'Repo'])
    )
  })

  it('shows a fade cue only while the chip row overflows and is not scrolled to the end', () => {
    const root = render(createElement(HostListToolbar, toolbarProps))
    const cue = (): ReactTestInstance[] =>
      root.findAll((node) => node.props.testID === 'host-list-toolbar-overflow-cue')
    const scroll = root.findByType('ScrollView')

    expect(cue()).toHaveLength(0)
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { width: 140, height: 44 } } })
      scroll.props.onContentSizeChange(260, 44)
    })
    expect(cue()).toHaveLength(1)
    act(() => {
      scroll.props.onScroll({
        nativeEvent: {
          contentOffset: { x: 120, y: 0 },
          contentSize: { width: 260, height: 44 },
          layoutMeasurement: { width: 140, height: 44 }
        }
      })
    })
    expect(cue()).toHaveLength(0)
  })

  it('shows no cue when every chip fits', () => {
    const root = render(createElement(HostListToolbar, toolbarProps))
    const scroll = root.findByType('ScrollView')
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { width: 300, height: 44 } } })
      scroll.props.onContentSizeChange(240, 44)
    })
    expect(
      root.findAll((node) => node.props.testID === 'host-list-toolbar-overflow-cue')
    ).toHaveLength(0)
  })
})

describe('workspace section header', () => {
  it('collapse row is at least 44 tall', () => {
    const root = render(
      createElement(WorkspaceSectionHeader, {
        title: 'Active',
        count: 3,
        collapsed: false,
        onToggle: () => {}
      })
    )
    const header = pressableByLabel(root, 'Collapse Active')
    expect(effectiveTarget(header).height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })
})

describe('worktree row lineage toggle', () => {
  it('is at least 44 tall', () => {
    const item: WorktreeListRowItem = {
      worktreeId: 'wt-1',
      repo: 'orca',
      branch: 'main',
      displayName: 'main',
      liveTerminalCount: 0,
      preview: '',
      unread: false,
      linkedPR: null,
      lineageChildCount: 2
    }
    const root = render(
      createElement(WorktreeListRow, {
        item,
        isReadOnly: false,
        now: 0,
        repoColor: '#fff',
        status: 'inactive',
        onPress: () => {},
        onToggleLineage: () => {}
      })
    )
    const toggle = pressableByLabel(root, 'Hide 2 children')
    expect(effectiveTarget(toggle).height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })
})
