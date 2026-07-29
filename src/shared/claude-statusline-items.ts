/**
 * Which fields the managed Claude status line renders, chosen from Settings.
 *
 * Why a shared module: the renderer draws the toggles, main persists them, and both script
 * generators consume them — all three must agree on the key set and the defaults.
 */

export const CLAUDE_STATUSLINE_ITEM_KEYS = [
  'project',
  'model',
  'context',
  'account',
  'fiveHourQuota',
  'sevenDayQuota',
  'cost',
  'resetCountdown'
] as const

export type ClaudeStatusLineItemKey = (typeof CLAUDE_STATUSLINE_ITEM_KEYS)[number]

export type ClaudeStatusLineItems = Record<ClaudeStatusLineItemKey, boolean>

// Why project defaults on: not knowing which project a pane belongs to is the owner-reported
// gap this feature closes. Why cost defaults off: it is a new field that spends columns the
// quota bars can otherwise grow into.
export const DEFAULT_CLAUDE_STATUSLINE_ITEMS: ClaudeStatusLineItems = {
  project: true,
  model: true,
  context: true,
  account: true,
  fiveHourQuota: true,
  sevenDayQuota: true,
  cost: false,
  resetCountdown: true
}

// Why the declared key order is also the default display order: the scripts have always
// rendered fields in this sequence, so an order-less profile keeps its exact legacy line.
export function normalizeClaudeStatusLineItemOrder(value: unknown): ClaudeStatusLineItemKey[] {
  const persisted = Array.isArray(value) ? value : []
  const order: ClaudeStatusLineItemKey[] = []
  for (const entry of persisted) {
    if (
      (CLAUDE_STATUSLINE_ITEM_KEYS as readonly unknown[]).includes(entry) &&
      !order.includes(entry as ClaudeStatusLineItemKey)
    ) {
      order.push(entry as ClaudeStatusLineItemKey)
    }
  }
  // Why append instead of reset: a profile persisted before a key existed keeps its custom
  // order, and the new key lands where the default order would have put it — never hidden.
  for (const key of CLAUDE_STATUSLINE_ITEM_KEYS) {
    if (!order.includes(key)) {
      order.push(key)
    }
  }
  return order
}

// Why tolerate partial/unknown input: older profiles persisted nothing, and a foreign or
// truncated value must degrade to defaults instead of hiding an item nobody chose to hide.
export function normalizeClaudeStatusLineItems(value: unknown): ClaudeStatusLineItems {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const items = { ...DEFAULT_CLAUDE_STATUSLINE_ITEMS }
  for (const key of CLAUDE_STATUSLINE_ITEM_KEYS) {
    const candidate = source[key]
    if (typeof candidate === 'boolean') {
      items[key] = candidate
    }
  }
  return items
}
