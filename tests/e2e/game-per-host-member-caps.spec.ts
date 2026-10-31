import { addEnvironmentFromPairingCode } from '../../src/shared/runtime-environment-store'
import { gameFleetReportOf } from '../../src/shared/orchestrator-game-fleet-verbs'
import { formatFleet } from '../../src/cli/handlers/orchestrator-game-fleet-format'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeStatus } from '../../src/shared/runtime-types'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { expect, test } from './helpers/orca-app'

// Why two real runtimes: the per-host cap crosses the wire on status.get, so a unit fake proves nothing about it.
test('a lead sums its own cap and each paired host’s, and an unreachable host adds none (ORCA-888)', async ({
  testRepoPath: _testRepoPath
}, testInfo) => {
  test.setTimeout(240_000)
  const hosts: HeadlessPairedRuntimeHost[] = []
  try {
    const home = await launchHeadlessPairedRuntimeHost()
    hosts.push(home)
    const imac = await launchHeadlessPairedRuntimeHost()
    hosts.push(imac)
    const gone = await launchHeadlessPairedRuntimeHost()
    hosts.push(gone)

    const published = (await imac.client.call<RuntimeStatus>('status.get')).result.gameHost
    expect(published).toEqual({
      totalMemory: expect.any(Number),
      cpuCoreCount: expect.any(Number),
      memberCap: expect.any(Number)
    })

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
    const local = (await home.client.call<RuntimeStatus>('status.get')).result.gameHost!
    expect(state.role).toBe('lead')
    expect(state.hosts).toEqual([
      { host: 'local', cap: local.memberCap, status: 'ok' },
      { host: 'imac', id: expect.any(String), cap: published!.memberCap, status: 'ok' },
      { host: 'm1', id: expect.any(String), cap: 0, status: 'unreachable' }
    ])
    expect(state.lead?.cap).toBe(local.memberCap + published!.memberCap)

    const fleet = formatFleet(gameFleetReportOf(state))
    await testInfo.attach('game-fleet.txt', { body: fleet, contentType: 'text/plain' })
    expect(fleet).toContain(
      `Hosts: local 0/${local.memberCap} · imac 0/${published!.memberCap} · m1 0 running, not answering`
    )
  } finally {
    for (const host of hosts.toReversed()) {
      await host.dispose()
    }
  }
})
