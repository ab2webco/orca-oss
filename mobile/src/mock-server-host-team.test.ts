import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { RpcResponse } from '../scripts/mock-server-rpc-handlers'
import { readHostTeamLine } from './hosts/host-team-read'

afterEach(() => {
  vi.resetModules()
})

describe('mock server host team', () => {
  it("answers the Home card's team read, so captures show the team line", async () => {
    const { handleRequest } = await import('../scripts/mock-server-rpc-handlers')
    const ws = { readyState: 1, OPEN: 1, once: () => {} } as unknown as WebSocket
    const client = {
      sendRequest: (method: string, params?: Record<string, unknown>) =>
        new Promise<RpcResponse>((resolve) =>
          handleRequest({ id: `${method}-1`, method, params }, resolve, ws)
        )
    } as never

    const status = await new Promise<RpcResponse>((resolve) =>
      handleRequest({ id: 'status-1', method: 'status.get' }, resolve, ws)
    )
    const capabilities = (status.result as { capabilities: string[] }).capabilities

    await expect(readHostTeamLine(client, capabilities)).resolves.toEqual({
      members: 6,
      working: 2,
      needsYou: 1
    })
  })
})
