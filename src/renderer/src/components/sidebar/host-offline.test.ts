import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { HostHeaderRow, HostSectionRow } from './host-section-rows'
import { dimOfflineHostRow, getOfflineHostRowIndexes, isHostOffline } from './host-offline'

function hostHeader(hostId: string, health: HostHeaderRow['health']): HostHeaderRow {
  return {
    type: 'host-header',
    key: `host:${hostId}`,
    hostId: hostId as HostHeaderRow['hostId'],
    kind: hostId === 'local' ? 'local' : 'ssh',
    label: hostId,
    detail: '',
    health,
    collapsed: false,
    count: 1,
    worktreeIds: []
  }
}

function projectHeader(key: string): HostSectionRow {
  return { type: 'header', key, label: key, count: 1, tone: '' }
}

describe('isHostOffline', () => {
  it('treats a disconnected or failed host as offline, but not one asking for auth or an update', () => {
    expect(isHostOffline({ health: 'disconnected' })).toBe(true)
    expect(isHostOffline({ health: 'error', connectionStatus: 'reconnection-failed' })).toBe(true)
    expect(isHostOffline({ health: 'error', connectionStatus: 'auth-failed' })).toBe(false)
    expect(isHostOffline({ health: 'blocked' })).toBe(false)
    expect(isHostOffline({ health: 'connecting' })).toBe(false)
    expect(isHostOffline({ health: 'available' })).toBe(false)
  })
})

describe('getOfflineHostRowIndexes', () => {
  it('marks every row under an offline host card and nothing under a live one', () => {
    const rows: HostSectionRow[] = [
      hostHeader('local', 'local'),
      projectHeader('repo:a'),
      hostHeader('ssh:contabo', 'disconnected'),
      projectHeader('repo:b'),
      projectHeader('repo:c'),
      hostHeader('ssh:m1', 'available'),
      projectHeader('repo:d')
    ]

    expect([...getOfflineHostRowIndexes(rows)]).toEqual([3, 4])
  })

  it('leaves workspace cards alone: they state the host themselves', () => {
    // Why: a subtree opacity would wash out the SSH control's destructive tint and spinner.
    const rows = [
      hostHeader('ssh:contabo', 'disconnected'),
      projectHeader('repo:b'),
      { type: 'item' },
      { type: 'lineage-group' },
      projectHeader('repo:c')
    ]

    expect([...getOfflineHostRowIndexes(rows)]).toEqual([1, 4])
  })

  it('marks nothing when no host card is drawn', () => {
    expect(getOfflineHostRowIndexes([projectHeader('repo:a')]).size).toBe(0)
  })
})

describe('dimOfflineHostRow', () => {
  it('dims what the row frame holds, not the frame, so a pinned header stays opaque', () => {
    const frame = createElement('div', { className: 'sticky bg-sidebar' }, 'orca-oss')

    const dimmed = dimOfflineHostRow(frame)
    const props = dimmed.props as { className: string; 'data-host-offline-row': string }

    expect(props.className).toBe('sticky bg-sidebar [&>*]:opacity-60')
    expect(props['data-host-offline-row']).toBe('')
  })
})
