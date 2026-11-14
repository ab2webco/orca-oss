import { describe, expect, it } from 'vitest'
import { accountsHostPickerRowsOf } from './accounts-host-picker-rows'

const hosts = [
  { id: 'm1', name: 'm1' },
  { id: 'imac', name: 'imac' },
  { id: 'contabo', name: 'contabo' },
  { id: 'new', name: 'new' }
]

describe('accountsHostPickerRowsOf', () => {
  it('names each paired host with its state, its Claude account count, and marks the open one', () => {
    const rows = accountsHostPickerRowsOf({
      hosts,
      states: { m1: 'connected', imac: 'connected', contabo: 'disconnected' },
      claudeCounts: { m1: 2, imac: 1 },
      currentHostId: 'm1'
    })

    expect(rows).toEqual([
      {
        id: 'm1',
        name: 'm1',
        status: 'Connected · 2 Claude accounts',
        tone: 'green',
        current: true
      },
      {
        id: 'imac',
        name: 'imac',
        status: 'Connected · 1 Claude account',
        tone: 'green',
        current: false
      },
      {
        id: 'contabo',
        name: 'contabo',
        status: "Can't reach desktop",
        tone: 'red',
        current: false
      },
      { id: 'new', name: 'new', status: 'Not connected', tone: 'muted', current: false }
    ])
  })

  it('claims no count it has not read, and names a dial in flight and a broken pairing', () => {
    const rows = accountsHostPickerRowsOf({
      hosts: hosts.slice(0, 3),
      states: { m1: 'connected', imac: 'reconnecting', contabo: 'auth-failed' },
      claudeCounts: {},
      currentHostId: 'imac'
    })

    expect(rows.map((row) => [row.status, row.tone])).toEqual([
      ['Connected', 'green'],
      ['Connecting…', 'amber'],
      ['Pairing invalid', 'red']
    ])
  })
})
