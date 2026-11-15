import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { readRuntimeMetadata } from './runtime-metadata'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { sendRequest } from './runtime-rpc-test-harness'
import { parsePairingCode } from '../../shared/pairing'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const servers: OrcaRuntimeRpcServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

async function startServer(enableWebSocket: boolean) {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
  const server = new OrcaRuntimeRpcServer({
    runtime: new OrcaRuntimeService(),
    userDataPath,
    ...(enableWebSocket ? { enableWebSocket: true, wsPort: 0 } : {})
  })
  servers.push(server)
  await server.start()
  const metadata = readRuntimeMetadata(userDataPath)!
  const unix = metadata.transports.find((transport) => transport.kind !== 'websocket')!
  return { server, endpoint: unix.endpoint, authToken: metadata.authToken }
}

describe('pairing.createMobileQr over the local socket', () => {
  it('mints a mobile pairing link for its own runtime', async () => {
    const { server, endpoint, authToken } = await startServer(true)

    const response = await sendRequest(endpoint, {
      id: 'req_pair',
      authToken,
      method: 'pairing.createMobileQr',
      params: { address: '10.0.2.2', connectionMode: 'local-only' }
    })

    expect(response.error).toBeUndefined()
    expect(response).toMatchObject({
      ok: true,
      result: { available: true, connectionMode: 'local-only' }
    })
    const result = response.result as { pairingUrl: string; endpoint: string; deviceId: string }
    expect(result.endpoint).toContain('10.0.2.2')
    expect(parsePairingCode(result.pairingUrl)?.scope).toBe('mobile')
    expect(server.getDeviceRegistry()?.getDevice(result.deviceId)?.scope).toBe('mobile')
  })

  it('tells the caller when the new link replaced an earlier unused one', async () => {
    const { endpoint, authToken } = await startServer(true)
    const mint = (rotate: boolean) =>
      sendRequest(endpoint, {
        id: 'req_pair',
        authToken,
        method: 'pairing.createMobileQr',
        params: { address: '10.0.2.2', connectionMode: 'local-only', rotate }
      })

    expect(await mint(false)).toMatchObject({ result: { replacedPendingLink: false } })
    expect(await mint(true)).toMatchObject({ result: { replacedPendingLink: true } })
  })

  it('says why when the runtime has no WebSocket listener to pair with', async () => {
    const { endpoint, authToken } = await startServer(false)

    const response = await sendRequest(endpoint, {
      id: 'req_pair',
      authToken,
      method: 'pairing.createMobileQr',
      params: { address: '10.0.2.2', connectionMode: 'local-only' }
    })

    expect(response.error).toBeUndefined()
    expect(response).toMatchObject({
      ok: true,
      result: { available: false, reason: 'websocket_unavailable' }
    })
  })
})
