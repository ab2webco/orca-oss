import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { ExecutionHostHealth } from '../../../../shared/execution-host-registry'
import {
  EMPTY_HOST_LIVE_OBSERVATION,
  getHostLastLiveAt,
  observeHostHealth,
  recordHostHealth,
  resetHostLastLive
} from './host-last-live-store'

const M1 = 'ssh:m1' as ExecutionHostId

function hosts(
  health: ExecutionHostHealth
): { id: ExecutionHostId; health: ExecutionHostHealth }[] {
  return [{ id: M1, health }]
}

describe('observeHostHealth', () => {
  it('knows no age for a host never seen connected in this session', () => {
    const seen = observeHostHealth(EMPTY_HOST_LIVE_OBSERVATION, hosts('disconnected'), 1_000)

    expect(seen.lastLiveAt.get(M1)).toBeUndefined()
  })

  it('stamps the moment a connected host is seen to drop, not the first time it was seen', () => {
    const connected = observeHostHealth(EMPTY_HOST_LIVE_OBSERVATION, hosts('available'), 1_000)
    const dropped = observeHostHealth(connected, hosts('disconnected'), 5_000)
    const later = observeHostHealth(dropped, hosts('disconnected'), 9_000)

    expect(dropped.lastLiveAt.get(M1)).toBe(5_000)
    expect(later.lastLiveAt.get(M1)).toBe(5_000)
  })

  it('keeps the drop time through a failed reconnect', () => {
    const connected = observeHostHealth(EMPTY_HOST_LIVE_OBSERVATION, hosts('available'), 1_000)
    const reconnecting = observeHostHealth(connected, hosts('connecting'), 2_000)
    const failed = observeHostHealth(reconnecting, hosts('error'), 8_000)

    expect(failed.lastLiveAt.get(M1)).toBe(2_000)
  })
})

describe('host last-live session store', () => {
  afterEach(() => resetHostLastLive())

  it('records what the store observed and exposes it per host', () => {
    recordHostHealth(hosts('available'), 1_000)
    recordHostHealth(hosts('disconnected'), 4_000)

    expect(getHostLastLiveAt(M1)).toBe(4_000)
    expect(getHostLastLiveAt('ssh:other' as ExecutionHostId)).toBeNull()
  })
})
