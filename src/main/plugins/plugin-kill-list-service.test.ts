import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginKillList } from '../../shared/plugins/plugin-kill-list'
import { fetchPluginKillList, PluginKillListService } from './plugin-kill-list-service'
import type { PluginKillListStore } from './plugin-kill-list-store'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-kill-list-'))
  roots.push(root)
  return root
}

function killList(date = '2026-07-12T20:00:00Z'): PluginKillList {
  return {
    version: 1,
    generatedAt: date,
    plugins: [{ pluginKey: 'community.unsafe', reason: 'Malware advisory' }]
  }
}

afterEach(async () => {
  vi.useRealTimers()
  // Why: vi.spyOn on an already-spied console method reuses the existing spy,
  // so without this the console assertions below see the prior test's calls.
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PluginKillListService', () => {
  it('loads cached revocations before any network refresh', async () => {
    const root = await tempRoot()
    const first = new PluginKillListService({
      pluginsDataDir: root,
      fetcher: async () => killList()
    })
    await first.refresh()
    const fetcher = vi.fn(async () => killList())
    const restarted = new PluginKillListService({ pluginsDataDir: root, fetcher })

    await restarted.initialize()

    expect(restarted.reason('community.unsafe')).toBe('Malware advisory')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('publishes valid refreshes and notifies runtime reconciliation', async () => {
    const service = new PluginKillListService({
      pluginsDataDir: await tempRoot(),
      fetcher: async () => killList()
    })
    const changed = vi.fn()
    service.onChanged(changed)

    await service.refresh()

    expect(service.find('community.unsafe')).toMatchObject({ reason: 'Malware advisory' })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('starts with no revocations after a corrupt cache and accepts a valid refresh', async () => {
    const store = {
      read: vi.fn().mockRejectedValue(new Error('invalid JSON')),
      write: vi.fn().mockResolvedValue(undefined)
    } as unknown as PluginKillListStore
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = new PluginKillListService({
      pluginsDataDir: await tempRoot(),
      store,
      fetcher: async () => killList()
    })

    await expect(service.initialize()).resolves.toBeUndefined()
    expect(service.snapshot()).toBeNull()
    await expect(service.refresh()).resolves.toEqual(killList())
    expect(service.reason('community.unsafe')).toBe('Malware advisory')
    expect(warning).toHaveBeenCalledWith(
      '[plugins] ignoring invalid cached plugin safety list:',
      expect.any(Error)
    )
  })

  it('keeps accepting genuine lists after a far-future snapshot is published', async () => {
    const root = await tempRoot()
    const fetcher = vi
      .fn<() => Promise<PluginKillList>>()
      .mockResolvedValueOnce(killList('9999-12-31T23:59:59Z'))
      .mockResolvedValueOnce(killList('2026-07-12T20:00:00Z'))
    const service = new PluginKillListService({ pluginsDataDir: root, fetcher })

    await expect(service.refresh()).rejects.toThrow()
    await expect(service.refresh()).resolves.toMatchObject({
      generatedAt: '2026-07-12T20:00:00Z'
    })
    expect(service.reason('community.unsafe')).toBe('Malware advisory')
    // The poisoned snapshot must not have been cached for the next launch.
    const restarted = new PluginKillListService({ pluginsDataDir: root, fetcher })
    await restarted.initialize()
    expect(restarted.snapshot()?.generatedAt).toBe('2026-07-12T20:00:00Z')
  })

  it('keeps cached revocations live when the device clock runs far behind', async () => {
    const root = await tempRoot()
    const generatedAt = new Date().toISOString()
    const published = new PluginKillListService({
      pluginsDataDir: root,
      fetcher: async () => killList(generatedAt)
    })
    await published.refresh()
    // A dead RTC / restored VM snapshot must not re-judge an already-accepted
    // cache against the wrong clock and silently un-revoke a killed plugin.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse(generatedAt) - 30 * 24 * 60 * 60 * 1000))
    const restarted = new PluginKillListService({
      pluginsDataDir: root,
      fetcher: async () => killList(generatedAt)
    })

    await restarted.initialize()

    expect(restarted.snapshot()?.generatedAt).toBe(generatedAt)
    expect(restarted.reason('community.unsafe')).toBe('Malware advisory')
    // A refresh the skewed clock cannot vouch for is refused, but refusing it
    // must never downgrade the revocations already in force.
    await expect(restarted.refresh()).rejects.toThrow()
    expect(restarted.reason('community.unsafe')).toBe('Malware advisory')
  })

  it('rejects a replayed older snapshot without replacing cached revocations', async () => {
    const fetcher = vi
      .fn<() => Promise<PluginKillList>>()
      .mockResolvedValueOnce(killList('2026-07-12T20:00:00Z'))
      .mockResolvedValueOnce(killList('2026-07-11T20:00:00Z'))
    const service = new PluginKillListService({ pluginsDataDir: await tempRoot(), fetcher })
    await service.refresh()

    await expect(service.refresh()).rejects.toThrow('older snapshot')
    expect(service.snapshot()?.generatedAt).toBe('2026-07-12T20:00:00Z')
  })
})

describe('PluginKillListService fork exemptions', () => {
  const exemptions = new Set(['community.unsafe'])

  it('keeps an exempted plugin running when a refresh revokes it', async () => {
    const service = new PluginKillListService({
      pluginsDataDir: await tempRoot(),
      fetcher: async () => killList(),
      exemptions
    })

    await expect(service.refresh()).resolves.toMatchObject({ plugins: [] })
    expect(service.find('community.unsafe')).toBeNull()
    expect(service.reason('community.unsafe')).toBeNull()
  })

  it('applies the exemption to a cache written before it shipped', async () => {
    const root = await tempRoot()
    const published = new PluginKillListService({
      pluginsDataDir: root,
      fetcher: async () => killList()
    })
    await published.refresh()

    const restarted = new PluginKillListService({ pluginsDataDir: root, exemptions })
    await restarted.initialize()

    expect(restarted.find('community.unsafe')).toBeNull()
  })

  it('caches what upstream published, so dropping the exemption restores the revocation', async () => {
    const root = await tempRoot()
    const exempted = new PluginKillListService({
      pluginsDataDir: root,
      fetcher: async () => killList(),
      exemptions
    })
    await exempted.refresh()

    // No fetcher: the revocation can only come back from the cache on disk.
    const withoutExemption = new PluginKillListService({ pluginsDataDir: root })
    await withoutExemption.initialize()

    expect(withoutExemption.reason('community.unsafe')).toBe('Malware advisory')
  })

  it('changes nothing while an exemption outlives the entry it overrode', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const service = new PluginKillListService({
      pluginsDataDir: await tempRoot(),
      fetcher: async () => killList(),
      // The steady state after upstream withdraws its advisory: the exemption
      // is still shipped, matches nothing, and must be inert rather than noisy.
      exemptions: new Set(['community.something-else'])
    })

    await expect(service.refresh()).resolves.toEqual(killList())
    expect(service.reason('community.unsafe')).toBe('Malware advisory')
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('exempts'))
  })

  it('records the keys a refresh newly revokes and the ones this fork overrode', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const revoking = new PluginKillListService({
      pluginsDataDir: await tempRoot(),
      fetcher: async () => killList()
    })
    await revoking.refresh()
    // A second refresh of the same list is not news and must stay silent.
    await revoking.refresh().catch(() => undefined)

    expect(info.mock.calls).toEqual([
      ['[plugins] upstream safety list newly revokes: community.unsafe']
    ])

    info.mockClear()
    const overriding = new PluginKillListService({
      pluginsDataDir: await tempRoot(),
      fetcher: async () => killList(),
      exemptions
    })
    await overriding.refresh()

    expect(info).toHaveBeenCalledWith(
      '[plugins] this fork exempts from the safety list: community.unsafe'
    )
  })
})

describe('fetchPluginKillList', () => {
  it('validates a bounded HTTPS response body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(killList()), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(fetchPluginKillList(fetcher)).resolves.toEqual(killList())
  })

  it('rejects non-success responses without leaving the body unread', async () => {
    const response = new Response('no', { status: 503 })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)

    await expect(fetchPluginKillList(fetcher)).rejects.toThrow('HTTP 503')

    // An abandoned body can crash the process from inside undici (orca#8695).
    expect(response.bodyUsed).toBe(true)
  })
})
