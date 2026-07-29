import { describe, expect, it } from 'vitest'
import {
  normalizeClaudeStatusLineItemOrder,
  normalizeClaudeStatusLineItems
} from '../../../../shared/claude-statusline-items'
import { composeStatusLine } from '../../../../shared/claude-statusline-line-model'
import { ClaudeStatusLinePreview } from './ClaudeStatusLinePreview'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is ReactElementLike {
  return typeof node === 'object' && node !== null && 'props' in node
}

function collectText(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectText(child, out)
    }
    return
  }
  if (isElement(node)) {
    collectText(node.props.children, out)
  }
}

describe('ClaudeStatusLinePreview', () => {
  const items = normalizeClaudeStatusLineItems({ cost: true })
  const order = normalizeClaudeStatusLineItemOrder(['model', 'project'])

  it('renders exactly the line the shared model composes for the given variant', () => {
    for (const variant of ['posix', 'windows'] as const) {
      const element = ClaudeStatusLinePreview({ items, order, variant })
      const text: string[] = []
      collectText(element, text)
      expect(text).toContain(composeStatusLine(items, order, variant))
    }
  })

  it('recomposes when an item flips, so the preview is live by construction', () => {
    const withoutCost = normalizeClaudeStatusLineItems({ cost: false })
    const before: string[] = []
    const after: string[] = []
    collectText(ClaudeStatusLinePreview({ items, order, variant: 'posix' }), before)
    collectText(ClaudeStatusLinePreview({ items: withoutCost, order, variant: 'posix' }), after)
    expect(before.join('')).toContain('$3.42')
    expect(after.join('')).not.toContain('$3.42')
  })
})
