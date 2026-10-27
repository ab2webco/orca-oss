import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedUIState } from '../../../shared/persisted-ui-state-types'
import {
  clearPendingPersistedUIWrite,
  overlayPendingPersistedUIWrite,
  setPendingPersistedUIWrite
} from './persisted-ui-pending-write'

const broadcast = { rightSidebarOpen: true, sidebarWidth: 280 } as PersistedUIState

describe('persisted UI pending write overlay', () => {
  const write = { rightSidebarOpen: false }
  afterEach(() => clearPendingPersistedUIWrite(write))

  it('keeps an unflushed local write over a stale broadcast', () => {
    setPendingPersistedUIWrite(write)
    expect(overlayPendingPersistedUIWrite(broadcast)).toMatchObject({
      rightSidebarOpen: false,
      sidebarWidth: 280
    })
  })

  it('passes the broadcast through once the write is cleared', () => {
    setPendingPersistedUIWrite(write)
    clearPendingPersistedUIWrite(write)
    expect(overlayPendingPersistedUIWrite(broadcast)).toBe(broadcast)
  })

  it('ignores a clear for a write that a newer one replaced', () => {
    const newer = { rightSidebarOpen: true }
    setPendingPersistedUIWrite(write)
    setPendingPersistedUIWrite(newer)
    clearPendingPersistedUIWrite(write)
    expect(overlayPendingPersistedUIWrite({ ...broadcast, rightSidebarOpen: false })).toMatchObject(
      { rightSidebarOpen: true }
    )
    clearPendingPersistedUIWrite(newer)
  })
})
