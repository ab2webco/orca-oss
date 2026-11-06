// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { useAdvisorPluginPresence } from './use-advisor-plugin-presence'

const { callRuntimeRpcMock } = vi.hoisted(() => ({ callRuntimeRpcMock: vi.fn() }))

vi.mock('../../runtime/runtime-rpc-client', () => ({ callRuntimeRpc: callRuntimeRpcMock }))

const ADVISOR = 'ab2web.orca-jev-advisor'
const SONAR = 'ab2web.orca-sonar'

const listed = (...keys: string[]): PluginHostListEntry[] =>
  keys.map((pluginKey) => ({ pluginKey }) as PluginHostListEntry)

async function presenceOf(repo: Pick<Repo, 'connectionId' | 'executionHostId'>): Promise<string> {
  let seen = ''
  const Probe = (): null => {
    seen = useAdvisorPluginPresence(repo)
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<Probe />))
  await act(async () => root.unmount())
  return seen
}

describe('useAdvisorPluginPresence', () => {
  const runtime = { executionHostId: 'runtime:env-1' } as Pick<Repo, 'executionHostId'>

  beforeEach(() => {
    callRuntimeRpcMock.mockReset()
    Object.assign(window, { api: { plugins: {} } })
    usePluginPanelsStore.setState({ plugins: [], fetchStatus: 'ready' })
  })

  it('reads a local project from the plugins of this machine', async () => {
    usePluginPanelsStore.setState({ plugins: listed(SONAR, ADVISOR) })
    expect(await presenceOf({})).toBe('installed')

    usePluginPanelsStore.setState({ plugins: listed(SONAR) })
    expect(await presenceOf({})).toBe('missing')
    expect(callRuntimeRpcMock).not.toHaveBeenCalled()
  })

  it('does not call a local plugin missing before the list has loaded', async () => {
    usePluginPanelsStore.setState({ fetchStatus: 'loading' })
    expect(await presenceOf({})).toBe('unknown')

    usePluginPanelsStore.setState({ fetchStatus: 'error' })
    expect(await presenceOf({})).toBe('unknown')
  })

  it('does not call a local plugin missing when the preload has no plugin bridge', async () => {
    Object.assign(window, { api: {} })
    expect(await presenceOf({})).toBe('unknown')
  })

  it('asks the paired host that runs the project, not this machine', async () => {
    usePluginPanelsStore.setState({ plugins: listed(ADVISOR) })
    callRuntimeRpcMock.mockResolvedValue(listed(SONAR))
    expect(await presenceOf(runtime)).toBe('missing')
    expect(callRuntimeRpcMock).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'plugins.list',
      undefined,
      { timeoutMs: 15_000 }
    )

    usePluginPanelsStore.setState({ plugins: [] })
    callRuntimeRpcMock.mockResolvedValue(listed(ADVISOR))
    expect(await presenceOf(runtime)).toBe('installed')
  })

  it('keeps the row when the paired host cannot answer', async () => {
    callRuntimeRpcMock.mockRejectedValue(new Error('method not found'))
    expect(await presenceOf(runtime)).toBe('unknown')

    callRuntimeRpcMock.mockResolvedValue({ unexpected: true })
    expect(await presenceOf(runtime)).toBe('unknown')
  })

  it('treats an SSH host as unknown: it has no Orca runtime to ask', async () => {
    usePluginPanelsStore.setState({ plugins: listed(SONAR) })
    expect(await presenceOf({ connectionId: 'ssh-1' })).toBe('unknown')
    expect(callRuntimeRpcMock).not.toHaveBeenCalled()
  })
})
