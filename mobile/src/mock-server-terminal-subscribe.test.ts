import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import { handleRequest, type RpcResponse } from '../scripts/mock-server-rpc-handlers'

describe('mock server terminal.subscribe', () => {
  it('sends the scrollback frame with no RPC delay configured', () => {
    const sent: RpcResponse[] = []
    const ws = { readyState: 1, OPEN: 1 } as unknown as WebSocket
    handleRequest(
      { id: 'subscribe-1', method: 'terminal.subscribe', params: { terminal: 'term-1' } },
      (response) => sent.push(response),
      ws
    )
    const types = sent.map((response) => (response.result as { type?: string } | undefined)?.type)
    expect(types).toContain('scrollback')
  })
})
