import { cloneElement, type ReactElement } from 'react'
import { cn } from '@/lib/utils'
import type { HostHeaderRow } from './host-section-rows'

/** A host whose rows are last-known data: disconnected, or failed for a reason other than auth. */
export function isHostOffline(host: Pick<HostHeaderRow, 'health' | 'connectionStatus'>): boolean {
  return (
    host.health === 'disconnected' ||
    (host.health === 'error' && host.connectionStatus !== 'auth-failed')
  )
}

function isHostHeaderRow(row: { type: string }): row is HostHeaderRow {
  return row.type === 'host-header'
}

/**
 * Indexes of the rows under an offline host card that dim (ORCA-1181). Workspace cards are
 * left out: an SSH card's inline host control states the drop, and a subtree opacity would wash
 * out its destructive tint and spinner; a runtime card already dims itself.
 */
export function getOfflineHostRowIndexes(rows: readonly { type: string }[]): Set<number> {
  const indexes = new Set<number>()
  let underOfflineHost = false
  rows.forEach((row, index) => {
    if (isHostHeaderRow(row)) {
      underOfflineHost = isHostOffline(row)
    } else if (underOfflineHost && row.type !== 'item' && row.type !== 'lineage-group') {
      indexes.add(index)
    }
  })
  return indexes
}

/** The disconnected-card dim, on the frame's content: a pinned frame's surface must stay opaque. */
export function dimOfflineHostRow(
  frame: ReactElement<Record<string, unknown>>
): ReactElement<Record<string, unknown>> {
  const className = typeof frame.props.className === 'string' ? frame.props.className : undefined
  return cloneElement(frame, {
    className: cn(className, '[&>*]:opacity-60'),
    'data-host-offline-row': ''
  })
}
