import { createElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_TOUCH_TARGET } from '../theme/mobile-theme'
import { TERMINAL_ACCESSORY_KEYS } from './terminal-accessory-keys'
import { TerminalAccessoryBar, type TerminalAccessoryBarProps } from './TerminalAccessoryBar'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Rect: 'Rect',
  Stop: 'Stop'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronsRight: 'ChevronsRight',
  Keyboard: 'Keyboard',
  Monitor: 'Monitor',
  Plus: 'Plus',
  Smartphone: 'Smartphone'
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

// Declared minimums plus hitSlop; a content-sized dimension counts as 0.
function effectiveTarget(node: ReactTestInstance): { width: number; height: number } {
  const style = flattenStyle(node.props.style)
  const slop = hitSlopInsets(node.props.hitSlop)
  return {
    width: dimension(style, 'minWidth', 'width') + slop.left + slop.right,
    height: dimension(style, 'minHeight', 'height') + slop.top + slop.bottom
  }
}

const unmounts: (() => void)[] = []

function render(overrides: Partial<TerminalAccessoryBarProps> = {}): ReactTestInstance {
  const props: TerminalAccessoryBarProps = {
    keyboardVisible: false,
    phoneDisplayMode: true,
    liveInputEnabled: false,
    canSend: true,
    canCompose: true,
    canPaste: true,
    builtInKeys: TERMINAL_ACCESSORY_KEYS,
    customKeys: [{ id: 'c1', label: 'git st', bytes: 'git status', enter: true }],
    onDismissKeyboard: () => {},
    onToggleDisplayMode: () => {},
    onToggleLiveInput: () => {},
    onPaste: () => {},
    onKeyPress: () => {},
    onRepeatStart: () => {},
    onRepeatStop: () => {},
    onCustomKeyPress: () => {},
    onCustomKeyLongPress: () => {},
    onAddCustomKey: () => {},
    ...overrides
  }
  let readRoot!: () => ReactTestInstance
  act(() => {
    const renderer = create(createElement(TerminalAccessoryBar, props))
    unmounts.push(() => renderer.unmount())
    readRoot = () => renderer.root
  })
  return readRoot()
}

afterEach(() => {
  act(() => unmounts.splice(0).forEach((unmount) => unmount()))
})

function pressableByLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)
}

function isInsideScroll(node: ReactTestInstance): boolean {
  for (let cur: ReactTestInstance | null = node.parent; cur; cur = cur.parent) {
    if (cur.type === 'ScrollView') {
      return true
    }
  }
  return false
}

describe('TerminalAccessoryBar', () => {
  it('gives every control a 44 pt touch target', () => {
    const root = render({ keyboardVisible: true })
    const pressables = root.findAll((node) => node.type === 'Pressable')
    expect(pressables.length).toBeGreaterThan(TERMINAL_ACCESSORY_KEYS.length)
    for (const node of pressables) {
      const target = effectiveTarget(node)
      expect(target.width, node.props.accessibilityLabel).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(target.height, node.props.accessibilityLabel).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
  })

  it('pins the mode toggles outside the scrolling key strip', () => {
    const root = render({ keyboardVisible: true })
    for (const label of [
      'Dismiss keyboard',
      'Switch to desktop mode',
      'Switch to live terminal input'
    ]) {
      expect(isInsideScroll(pressableByLabel(root, label)), label).toBe(false)
    }
    for (const label of ['Escape', 'Paste from clipboard', 'Send git st', 'Add custom shortcut']) {
      expect(isInsideScroll(pressableByLabel(root, label)), label).toBe(true)
    }
  })

  it('keeps the live/buffered toggle reachable offline while keys stay send-gated', () => {
    const root = render({ canSend: false, canCompose: true })
    expect(pressableByLabel(root, 'Switch to live terminal input').props.disabled).toBe(false)
    expect(pressableByLabel(root, 'Escape').props.disabled).toBe(true)
    expect(pressableByLabel(root, 'Switch to desktop mode').props.disabled).toBe(true)
  })

  it('routes repeatable keys through press-in repeat and others through press', () => {
    const onKeyPress = vi.fn()
    const onRepeatStart = vi.fn()
    const onRepeatStop = vi.fn()
    const root = render({ onKeyPress, onRepeatStart, onRepeatStop })

    const backspace = pressableByLabel(root, 'Backspace')
    act(() => {
      backspace.props.onPressIn()
      backspace.props.onPress?.()
      backspace.props.onPressOut()
    })
    expect(onRepeatStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'backspace' }))
    expect(onRepeatStop).toHaveBeenCalledTimes(1)
    expect(onKeyPress).not.toHaveBeenCalled()

    const escape = pressableByLabel(root, 'Escape')
    act(() => {
      escape.props.onPressIn?.()
      escape.props.onPress()
      escape.props.onPressOut?.()
    })
    expect(onKeyPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'escape' }))
    expect(onRepeatStart).toHaveBeenCalledTimes(1)
  })

  it('shows a fade cue only while more keys sit past the right edge', () => {
    const root = render()
    const cue = (): ReactTestInstance[] =>
      root.findAll((node) => node.props.testID === 'terminal-accessory-overflow-cue')
    const scroll = root.findByType('ScrollView')

    expect(cue()).toHaveLength(0)
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { width: 260, height: 44 } } })
      scroll.props.onContentSizeChange(900, 44)
    })
    expect(cue()).toHaveLength(1)
    act(() => {
      scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 640, y: 0 } } })
    })
    expect(cue()).toHaveLength(0)
  })
})
