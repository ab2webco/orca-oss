import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SettingsSegmentedControl } from './SettingsFormControls'
import { TerminalPaneActionsPositionSetting } from './TerminalPaneActionsPositionSetting'
import { TerminalPaneAppearanceSection } from './TerminalPaneAppearanceSection'
import { getTerminalPaneAppearanceSearchEntries } from './terminal-pane-appearance-search'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown>
}

function visit(node: unknown, cb: (node: ReactElementLike) => void): void {
  if (node == null || typeof node !== 'object') {
    return
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => visit(entry, cb))
    return
  }
  const element = node as ReactElementLike
  cb(element)
  visit(element.props?.children, cb)
  visit(element.props?.control, cb)
}

function findSegmentedControl(node: unknown, ariaLabel: string): ReactElementLike {
  let found: ReactElementLike | null = null
  visit(node, (entry) => {
    if (entry.type === SettingsSegmentedControl && entry.props.ariaLabel === ariaLabel) {
      found = entry
    }
  })
  if (!found) {
    throw new Error(`${ariaLabel} control not found`)
  }
  return found
}

function renderSection(overrides: Partial<GlobalSettings> = {}) {
  const updateSettings = vi.fn()
  const tree = TerminalPaneActionsPositionSetting({
    settings: { ...getDefaultSettings('/home/user'), ...overrides },
    updateSettings
  })
  return {
    updateSettings,
    edge: findSegmentedControl(tree, 'Pane actions edge'),
    align: findSegmentedControl(tree, 'Pane actions alignment')
  }
}

describe('TerminalPaneAppearanceSection pane actions position', () => {
  it('shows the bottom-right default', () => {
    const { edge, align } = renderSection()
    expect(edge.props.value).toBe('bottom')
    expect(align.props.value).toBe('right')
  })

  it('shows bottom-right when the stored value is unknown', () => {
    const { edge, align } = renderSection({
      terminalPaneActionsPosition: 'middle' as GlobalSettings['terminalPaneActionsPosition']
    })
    expect(edge.props.value).toBe('bottom')
    expect(align.props.value).toBe('right')
  })

  it('changes the edge and keeps the alignment', () => {
    const { edge, updateSettings } = renderSection({ terminalPaneActionsPosition: 'bottom-left' })
    ;(edge.props.onChange as (value: string) => void)('top')
    expect(updateSettings).toHaveBeenCalledWith({ terminalPaneActionsPosition: 'top-left' })
  })

  it('changes the alignment and keeps the edge', () => {
    const { align, updateSettings } = renderSection({ terminalPaneActionsPosition: 'top-right' })
    ;(align.props.onChange as (value: string) => void)('center')
    expect(updateSettings).toHaveBeenCalledWith({ terminalPaneActionsPosition: 'top-center' })
  })

  it('is mounted in the Terminal Panes section', () => {
    const settings = getDefaultSettings('/home/user')
    const tree = TerminalPaneAppearanceSection({ settings, updateSettings: vi.fn() })
    let mounted = false
    visit(tree, (entry) => {
      mounted ||= entry.type === TerminalPaneActionsPositionSetting
    })
    expect(mounted).toBe(true)
  })

  it('is findable from settings search', () => {
    expect(getTerminalPaneAppearanceSearchEntries().map((entry) => entry.title)).toContain(
      'Pane Actions Position'
    )
  })
})
