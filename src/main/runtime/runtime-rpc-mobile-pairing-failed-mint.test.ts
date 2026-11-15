import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { parsePairingCode } from '../../shared/pairing'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

function createServer(): OrcaRuntimeRpcServer {
  return new OrcaRuntimeRpcServer({
    runtime: new OrcaRuntimeService(),
    userDataPath: mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-')),
    enableWebSocket: true,
    wsPort: 0
  })
}

function deviceTokenOf(pairingUrl: string): string {
  const parsed = parsePairingCode(pairingUrl)
  if (!parsed) {
    throw new Error('unparseable pairing link')
  }
  return parsed.deviceToken
}

describe('OrcaRuntimeRpcServer mobile mint that fails', () => {
  it('keeps the pending LAN link valid when a later Relay mint fails', async () => {
    const server = createServer()
    server.setMobileRelayPairingProvider({
      createPairingRelay: vi.fn().mockRejectedValue(new Error('relay_control_not_active')),
      onDeviceRevokeQueued: vi.fn(),
      getEndpoints: vi.fn(),
      provisionRelay: vi.fn()
    })

    await server.start()
    try {
      const lan = await server.createMobilePairingOffer({
        address: '10.0.2.2',
        connectionMode: 'local-only'
      })
      if (!lan.available) {
        throw new Error('LAN pairing unavailable')
      }

      const relay = await server.createMobilePairingOffer({ address: '10.0.2.2' })

      expect(relay).toMatchObject({ available: false, reason: 'relay_mint_failed' })
      const registry = server.getDeviceRegistry()
      expect(registry?.getPendingDevice('mobile')?.deviceId).toBe(lan.deviceId)
      expect(registry?.validateToken(deviceTokenOf(lan.pairingUrl))?.deviceId).toBe(lan.deviceId)
      expect(registry?.getMobilePairingConnectionMode(lan.deviceId)).toBe('local-only')
    } finally {
      await server.stop()
    }
  })

  it('keeps the pending link when a rotating Relay mint fails', async () => {
    const server = createServer()
    server.setMobileRelayPairingProvider({
      createPairingRelay: vi.fn().mockRejectedValue(new Error('relay offline')),
      onDeviceRevokeQueued: vi.fn(),
      getEndpoints: vi.fn(),
      provisionRelay: vi.fn()
    })

    await server.start()
    try {
      const lan = await server.createMobilePairingOffer({
        address: '10.0.2.2',
        connectionMode: 'local-only'
      })
      if (!lan.available) {
        throw new Error('LAN pairing unavailable')
      }

      await server.createMobilePairingOffer({ address: '10.0.2.2', rotate: true })

      expect(
        server
          .getDeviceRegistry()
          ?.listDevices()
          .map((device) => device.deviceId)
      ).toEqual([lan.deviceId])
    } finally {
      await server.stop()
    }
  })

  it('reports when a successful mint replaced the earlier unused link', async () => {
    const server = createServer()

    await server.start()
    try {
      const first = await server.createMobilePairingOffer({
        address: '10.0.2.2',
        connectionMode: 'local-only'
      })
      const reused = await server.createMobilePairingOffer({
        address: '10.0.2.2',
        connectionMode: 'local-only'
      })
      const rotated = await server.createMobilePairingOffer({
        address: '10.0.2.2',
        connectionMode: 'local-only',
        rotate: true
      })

      expect(first).toMatchObject({ available: true, replacedPendingLink: false })
      expect(reused).toMatchObject({ available: true, replacedPendingLink: false })
      expect(rotated).toMatchObject({ available: true, replacedPendingLink: true })
      if (!first.available || !rotated.available) {
        throw new Error('LAN pairing unavailable')
      }
      const registry = server.getDeviceRegistry()
      expect(registry?.validateToken(deviceTokenOf(first.pairingUrl))).toBeNull()
      expect(registry?.getPendingDevice('mobile')?.deviceId).toBe(rotated.deviceId)
    } finally {
      await server.stop()
    }
  })
})
