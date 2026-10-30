import { addEnvironmentFromPairingCode } from '../../src/shared/runtime-environment-store'
import { formatGameHostCapacity } from '../../src/shared/orchestrator-game-host-capacity'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { MemorySnapshot } from '../../src/shared/process-stats-types'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { expect, test } from './helpers/orca-app'

// Why real runtimes: the figures cross the wire on the host's diagnostics.memory, which a unit fake cannot prove.
test('a lead lists each paired host with its cores, memory and load, and names a silent one (ORCA-841)', async ({
  testRepoPath: _testRepoPath
}, testInfo) => {
  test.setTimeout(240_000)
  const hosts: HeadlessPairedRuntimeHost[] = []
  try {
    const home = await launchHeadlessPairedRuntimeHost()
    hosts.push(home)
    const alone = (await home.client.call<OrchestratorGameState>('game.state', {})).result
    expect(alone.hostCapacity, 'a lone Orca lists no hosts').toBeUndefined()

    const imac = await launchHeadlessPairedRuntimeHost()
    hosts.push(imac)
    const gone = await launchHeadlessPairedRuntimeHost()
    hosts.push(gone)
    addEnvironmentFromPairingCode(home.userDataDir, {
      name: 'imac',
      pairingCode: imac.offer.pairingUrl
    })
    addEnvironmentFromPairingCode(home.userDataDir, {
      name: 'm1',
      pairingCode: gone.offer.pairingUrl
    })
    await gone.dispose()
    hosts.splice(hosts.indexOf(gone), 1)

    const state = (
      await home.client.call<OrchestratorGameState>('game.state', {}, { timeoutMs: 30_000 })
    ).result
    const own = (await imac.client.call<MemorySnapshot>('diagnostics.memory')).result.host
    const ok = {
      running: 0,
      status: 'ok',
      cpuCoreCount: own.cpuCoreCount,
      totalMemory: own.totalMemory,
      availableMemory: expect.any(Number),
      loadAverage1m: process.platform === 'win32' ? null : expect.any(Number)
    }
    expect(state.role).toBe('lead')
    expect(state.hostCapacity).toEqual([
      { host: 'local', ...ok },
      { host: 'imac', ...ok },
      { host: 'm1', running: 0, status: 'unreachable' }
    ])
    const text = formatGameHostCapacity(state.hostCapacity!).join('\n')
    await testInfo.attach('hosts.txt', { body: text, contentType: 'text/plain' })
    expect(text).toMatch(
      new RegExp(`imac   0 running · ${own.cpuCoreCount} cores · [\\d.]+ of \\d+(\\.\\d)? GB free`)
    )
    expect(text).toContain('m1     0 running · not answering')
  } finally {
    for (const host of hosts.toReversed()) {
      await host.dispose()
    }
  }
})
