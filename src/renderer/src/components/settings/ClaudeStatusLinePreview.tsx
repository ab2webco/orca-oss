import React from 'react'
import type {
  ClaudeStatusLineItemKey,
  ClaudeStatusLineItems
} from '../../../../shared/claude-statusline-items'
import {
  composeStatusLine,
  type ClaudeStatusLineVariant
} from '../../../../shared/claude-statusline-line-model'
import {
  getClaudeStatusLinePreviewLabel,
  getClaudeStatusLinePreviewNote
} from './claude-statusline-items-copy'

type ClaudeStatusLinePreviewProps = {
  items: ClaudeStatusLineItems
  order: readonly ClaudeStatusLineItemKey[]
  /** Overridable for tests; defaults to the variant of the OS the app runs on. */
  variant?: ClaudeStatusLineVariant
}

// Why the running OS decides the variant: the posix and windows scripts render different
// glyphs and separators, and the preview must show the line THIS machine's terminals get.
function detectStatusLineVariant(): ClaudeStatusLineVariant {
  try {
    return window.api.platform.get().platform === 'win32' ? 'windows' : 'posix'
  } catch {
    return 'posix'
  }
}

/**
 * The steady-state line the managed script would print for the current toggles, from the
 * shared line model with stable example data — recomposed on every settings change, so it
 * updates live as the switches and order flip.
 */
export function ClaudeStatusLinePreview({
  items,
  order,
  variant
}: ClaudeStatusLinePreviewProps): React.JSX.Element {
  const line = composeStatusLine(items, order, variant ?? detectStatusLineVariant())
  return (
    <div className="space-y-1">
      <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
        <div
          aria-label={getClaudeStatusLinePreviewLabel()}
          className="scrollbar-sleek select-text overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground/90"
        >
          {line}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{getClaudeStatusLinePreviewNote()}</p>
    </div>
  )
}
