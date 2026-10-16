import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useHostPluginPanels } from './use-host-plugin-panels'

function mountPanels(connState: ConnectionState) {
  const client = {
    sendRequest: () => new Promise<never>(() => {})
  } as unknown as RpcClient
  let latest: ReturnType<typeof useHostPluginPanels> | null = null

  function Probe({ state }: { state: ConnectionState }) {
    latest = useHostPluginPanels({ client, connState: state, supported: true })
    return null
  }

  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe, { state: connState }))
  })
  return {
    get refreshing(): boolean {
      return latest?.refreshing ?? false
    },
    setConnState(state: ConnectionState) {
      act(() => {
        renderer.update(createElement(Probe, { state }))
      })
    }
  }
}

describe('useHostPluginPanels', () => {
  it('stops the refresh spinner when the connection drops mid-request', () => {
    const probe = mountPanels('connected')
    expect(probe.refreshing).toBe(true)

    probe.setConnState('disconnected')

    expect(probe.refreshing).toBe(false)
  })
})
