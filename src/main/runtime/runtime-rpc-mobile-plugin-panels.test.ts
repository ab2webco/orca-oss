import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import type { PluginService } from '../plugins/plugin-service'
import { setPluginServiceForRpc } from './rpc/methods/plugins'
import {
  authenticateMobileWsSession,
  createEncryptedWsResponseReader,
  sendEncryptedWsRequest
} from './runtime-rpc-mobile-ws-test-harness'

const SESSION_TOKEN = 's'.repeat(43)

function runtimeProxy(): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'plugin-panels-runtime-test',
    getStartedAt: () => 1,
    getStatus: () => ({ graphStatus: 'unavailable' }),
    cleanupSubscriptionsForConnection: () => {},
    cancelMobileDictationForConnection: () => {},
    onClientDisconnected: () => {}
  } as unknown as OrcaRuntimeService
}

function pluginService() {
  const panels = {
    open: vi.fn().mockResolvedValue({ html: '<p>panel</p>', sessionToken: SESSION_TOKEN }),
    execute: vi.fn().mockResolvedValue({ ok: true, value: null }),
    release: vi.fn().mockReturnValue(true),
    bindOwnerSignal: vi.fn(),
    revokeOwner: vi.fn()
  }
  const service = {
    whenReady: vi.fn().mockResolvedValue(undefined),
    panels
  } as unknown as PluginService
  return { service, panels }
}

async function startPhoneSession() {
  const server = new OrcaRuntimeRpcServer({
    runtime: runtimeProxy(),
    userDataPath: mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-')),
    enableWebSocket: true,
    wsPort: 0
  })
  await server.start()
  const offer = server.createPairingOffer({ address: '127.0.0.1', name: 'phone', scope: 'mobile' })
  if (!offer.available) {
    throw new Error('WebSocket pairing unavailable')
  }
  const session = await authenticateMobileWsSession(offer.pairingUrl)
  return { server, session, responses: createEncryptedWsResponseReader(session) }
}

afterEach(() => setPluginServiceForRpc(null))

describe('plugin panels over a paired phone connection', () => {
  it('lets a phone load a panel, act through it and release it', async () => {
    const { service, panels } = pluginService()
    setPluginServiceForRpc(service)
    const { server, session, responses } = await startPhoneSession()
    try {
      sendEncryptedWsRequest(session, {
        id: 'open',
        method: 'plugins.readPanelEntry',
        params: { pluginKey: 'demo.board', panelId: 'board' }
      })
      await expect(responses.next('open')).resolves.toMatchObject({
        ok: true,
        result: { sessionToken: SESSION_TOKEN }
      })
      sendEncryptedWsRequest(session, {
        id: 'act',
        method: 'plugins.panelAction',
        params: { sessionToken: SESSION_TOKEN, action: 'storage.get', params: { key: 'k' } }
      })
      await expect(responses.next('act')).resolves.toMatchObject({
        ok: true,
        result: { outcome: { ok: true } }
      })
      sendEncryptedWsRequest(session, {
        id: 'release',
        method: 'plugins.releasePanel',
        params: { sessionToken: SESSION_TOKEN }
      })
      await expect(responses.next('release')).resolves.toMatchObject({
        ok: true,
        result: { released: true }
      })
      const owner = panels.open.mock.calls[0]![0] as string
      expect(panels.execute.mock.calls[0]![0]).toBe(owner)
      expect(panels.release).toHaveBeenCalledWith(owner, SESSION_TOKEN)
    } finally {
      responses.dispose()
      session.ws.close()
      await server.stop()
    }
  })

  it('revokes the connection panel owner when the phone socket closes', async () => {
    const { service, panels } = pluginService()
    setPluginServiceForRpc(service)
    const { server, session, responses } = await startPhoneSession()
    try {
      sendEncryptedWsRequest(session, {
        id: 'open',
        method: 'plugins.readPanelEntry',
        params: { pluginKey: 'demo.board', panelId: 'board' }
      })
      await responses.next('open')
      const owner = panels.open.mock.calls[0]![0] as string
      // Owner-specific: a previous test's socket can finish closing late.
      expect(panels.revokeOwner).not.toHaveBeenCalledWith(owner)

      session.ws.close()

      await vi.waitFor(() => expect(panels.revokeOwner).toHaveBeenCalledWith(owner))
    } finally {
      responses.dispose()
      await server.stop()
    }
  })

  it('keeps plugin consent, enablement and commands off the phone', async () => {
    const { service } = pluginService()
    setPluginServiceForRpc(service)
    const { server, session, responses } = await startPhoneSession()
    try {
      for (const method of ['plugins.consent', 'plugins.setEnabled', 'plugins.invokeCommand']) {
        sendEncryptedWsRequest(session, { id: method, method, params: {} })
        await expect(responses.next(method)).resolves.toMatchObject({ ok: false })
      }
    } finally {
      responses.dispose()
      session.ws.close()
      await server.stop()
    }
  })
})
