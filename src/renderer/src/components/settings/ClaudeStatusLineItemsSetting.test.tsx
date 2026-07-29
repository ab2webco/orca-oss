import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  CLAUDE_STATUSLINE_ITEM_KEYS,
  DEFAULT_CLAUDE_STATUSLINE_ITEMS,
  type ClaudeStatusLineItemKey
} from '../../../../shared/claude-statusline-items'
import { getAgentsPaneSearchEntries } from './AgentsPane'
import {
  getClaudeStatusLineItemCopy,
  getClaudeStatusLineTitle
} from './claude-statusline-items-copy'
import { ClaudeStatusLineItemsSetting } from './ClaudeStatusLineItemsSetting'
import { ClaudeStatusLinePreview } from './ClaudeStatusLinePreview'
import { matchesSettingsSearch } from './settings-search'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is ReactElementLike {
  return typeof node === 'object' && node !== null && 'props' in node
}

function visit(node: unknown, onElement: (entry: ReactElementLike) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      visit(child, onElement)
    }
    return
  }
  if (!isElement(node)) {
    return
  }
  onElement(node)
  visit(node.props.children, onElement)
}

function findSwitchRow(node: unknown, ariaLabel: string): ReactElementLike {
  let found: ReactElementLike | null = null
  visit(node, (entry) => {
    if (
      entry.props.ariaLabel === ariaLabel &&
      typeof entry.props.checked === 'boolean' &&
      typeof entry.props.onChange === 'function'
    ) {
      found = entry
    }
  })
  if (!found) {
    throw new Error(`switch row not found: ${ariaLabel}`)
  }
  return found
}

describe('ClaudeStatusLineItemsSetting', () => {
  it('renders one switch per item with the persisted (defaulted) value', () => {
    const element = ClaudeStatusLineItemsSetting({
      settings: getDefaultSettings('/tmp'),
      updateSettings: vi.fn()
    })
    for (const key of CLAUDE_STATUSLINE_ITEM_KEYS) {
      const row = findSwitchRow(element, getClaudeStatusLineItemCopy(key).label)
      expect(row.props.checked).toBe(DEFAULT_CLAUDE_STATUSLINE_ITEMS[key])
    }
  })

  it('persists the full normalized record with the toggled key flipped', () => {
    const updateSettings = vi.fn()
    const element = ClaudeStatusLineItemsSetting({
      settings: { ...getDefaultSettings('/tmp'), claudeStatusLineItems: { cost: true } },
      updateSettings
    })

    const costRow = findSwitchRow(element, getClaudeStatusLineItemCopy('cost').label)
    expect(costRow.props.checked).toBe(true)
    ;(costRow.props.onChange as () => void)()

    // Why the full record: main rewrites the shared script from this value, so unset keys
    // must resolve to their defaults at write time, not stay ambiguous.
    expect(updateSettings).toHaveBeenCalledWith({
      claudeStatusLineItems: { ...DEFAULT_CLAUDE_STATUSLINE_ITEMS, cost: false }
    })
  })

  it('is discoverable through settings search', () => {
    expect(matchesSettingsSearch('status line', getAgentsPaneSearchEntries())).toBe(true)
    expect(matchesSettingsSearch('statusline', getAgentsPaneSearchEntries())).toBe(true)
    expect(matchesSettingsSearch('quota', getAgentsPaneSearchEntries())).toBe(true)
    const entries = getAgentsPaneSearchEntries()
    expect(entries.some((entry) => entry.title === getClaudeStatusLineTitle())).toBe(true)
  })

  it('renders the rows in the persisted order and embeds the live preview with it', () => {
    const order: ClaudeStatusLineItemKey[] = [
      'model',
      'project',
      'context',
      'resetCountdown',
      'account',
      'fiveHourQuota',
      'sevenDayQuota',
      'cost'
    ]
    const element = ClaudeStatusLineItemsSetting({
      settings: { ...getDefaultSettings('/tmp'), claudeStatusLineItemOrder: order },
      updateSettings: vi.fn()
    })
    const rowLabels: unknown[] = []
    let previewProps: Record<string, unknown> | null = null
    visit(element, (entry) => {
      if (typeof entry.props.ariaLabel === 'string' && typeof entry.props.checked === 'boolean') {
        rowLabels.push(entry.props.ariaLabel)
      }
      if (entry.type === ClaudeStatusLinePreview) {
        previewProps = entry.props
      }
    })
    expect(rowLabels).toEqual(order.map((key) => getClaudeStatusLineItemCopy(key).label))
    expect(previewProps).not.toBeNull()
    expect(previewProps?.['order']).toEqual(order)
  })

  it('persists the full normalized order with the moved key swapped', () => {
    const updateSettings = vi.fn()
    const element = ClaudeStatusLineItemsSetting({
      settings: getDefaultSettings('/tmp'),
      updateSettings
    })
    const projectRow = findSwitchRow(element, getClaudeStatusLineItemCopy('project').label)
    expect(projectRow.props.canMoveUp).toBe(false)
    ;(projectRow.props.onMoveDown as () => void)()
    expect(updateSettings).toHaveBeenCalledWith({
      claudeStatusLineItemOrder: [
        'model',
        'project',
        'context',
        'account',
        'fiveHourQuota',
        'sevenDayQuota',
        'cost',
        'resetCountdown'
      ]
    })
  })
})
