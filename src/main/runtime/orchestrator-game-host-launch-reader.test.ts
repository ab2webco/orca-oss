import { describe, expect, it, vi } from 'vitest'
import type { GameRepoSummary } from '../../shared/orchestrator-game-member-repo-scope'
import { GameHostLaunchReader, gameHostLaunchesOf } from './orchestrator-game-host-launch-reader'

const repo = (id: string, remoteKey: string): GameRepoSummary => ({
  id,
  displayName: 'orca-oss',
  path: `/work/${id}`,
  remoteKey,
  ownRemoteKey: remoteKey
})
const lead = repo('r_lead', 'github.com/ab2webco/orca-oss')
const onM1 = repo('h_m1', 'github.com/ab2webco/orca-oss')

function readerOf() {
  let now = 0
  const readRepos = vi.fn(async (id: string) => {
    if (id === 'env_imac') {
      throw new Error('not answering')
    }
    return id === 'env_m1' ? [onM1] : []
  })
  const readLead = vi.fn(async () => lead)
  const reader = new GameHostLaunchReader({
    list: () => [
      { id: 'env_m1', name: 'm1' },
      { id: 'env_koombea', name: 'koombea' },
      { id: 'env_imac', name: 'imac' }
    ],
    readRepos,
    readLead,
    now: () => now
  })
  return { reader, readRepos, readLead, advance: (ms: number) => (now += ms) }
}

describe('GameHostLaunchReader', () => {
  it("names each paired host ready, not registered, or silent for the lead's project", async () => {
    const { reader } = readerOf()
    const launches = gameHostLaunchesOf(await reader.read('r_lead'))
    expect(launches.get('m1')).toEqual({ kind: 'ready', repo: onM1 })
    expect(launches.get('koombea')?.kind).toBe('unregistered')
    expect(launches.get('imac')).toEqual({ kind: 'unanswered' })
  })

  it('serves a fresh read without dialing again, and rereads a silent host sooner', async () => {
    const { reader, readRepos, readLead, advance } = readerOf()
    await reader.read('r_lead')
    advance(20_000)
    await reader.read('r_lead')
    // Only the silent imac was due again; its stale answer served while it reread.
    expect(readRepos.mock.calls.map(([id]) => id)).toEqual([
      'env_m1',
      'env_koombea',
      'env_imac',
      'env_imac'
    ])
    expect(readLead).toHaveBeenCalledTimes(1)
  })

  it('reads no lead without a lead repo, so every host is refused', async () => {
    const { reader, readLead } = readerOf()
    const launches = gameHostLaunchesOf(await reader.read(null))
    expect(readLead).not.toHaveBeenCalled()
    expect(launches.get('m1')?.kind).toBe('refused')
  })
})
