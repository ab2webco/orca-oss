import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrcaRuntimeService as RuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { DASHBOARD_POPOUT_METHODS } from './dashboard-popout'

function request(method: string, params?: unknown): RpcRequest {
  return { id: 'dashboard-popout-test', authToken: 'test', method, params }
}

describe('dashboard popout RPC methods', () => {
  it('drives the app-owned state in both directions without duplicate transitions', () => {
    let open = false
    const transitions: boolean[] = []
    const runtime = new RuntimeService(
      { getSettings: () => ({ experimentalAgentDashboardPopout: true }) } as never,
      undefined,
      {
        getDashboardPopoutOpen: () => open,
        setDashboardPopoutOpen: (next) => {
          transitions.push(next)
          open = next
        }
      }
    )

    expect(runtime.getDashboardPopoutOpen()).toBe(false)
    expect(runtime.setDashboardPopoutOpen(true)).toEqual({ open: true, changed: true })
    expect(runtime.setDashboardPopoutOpen(true)).toEqual({ open: true, changed: false })
    expect(runtime.setDashboardPopoutOpen(false)).toEqual({ open: false, changed: true })
    expect(transitions).toEqual([true, false])
  })

  it('rejects writes when the experimental feature is disabled', () => {
    const runtime = new RuntimeService(
      { getSettings: () => ({ experimentalAgentDashboardPopout: false }) } as never,
      undefined,
      { getDashboardPopoutOpen: () => false, setDashboardPopoutOpen: vi.fn() }
    )

    expect(() => runtime.setDashboardPopoutOpen(true)).toThrow(
      'The Agent Dashboard popout feature is disabled in this Orca host.'
    )
  })

  it('reads the app-owned state', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime',
      getDashboardPopoutOpen: vi.fn(() => true)
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: DASHBOARD_POPOUT_METHODS })

    await expect(dispatcher.dispatch(request('dashboardPopout.get'))).resolves.toMatchObject({
      ok: true,
      result: { open: true }
    })
    expect(runtime.getDashboardPopoutOpen).toHaveBeenCalledOnce()
  })

  it('sets both directions and reports idempotent requests', async () => {
    const setDashboardPopoutOpen = vi
      .fn()
      .mockReturnValueOnce({ open: true, changed: true })
      .mockReturnValueOnce({ open: true, changed: false })
      .mockReturnValueOnce({ open: false, changed: true })
    const runtime = {
      getRuntimeId: () => 'runtime',
      setDashboardPopoutOpen
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: DASHBOARD_POPOUT_METHODS })

    await expect(
      dispatcher.dispatch(request('dashboardPopout.set', { open: true }))
    ).resolves.toMatchObject({ ok: true, result: { open: true, changed: true } })
    await expect(
      dispatcher.dispatch(request('dashboardPopout.set', { open: true }))
    ).resolves.toMatchObject({ ok: true, result: { open: true, changed: false } })
    await expect(
      dispatcher.dispatch(request('dashboardPopout.set', { open: false }))
    ).resolves.toMatchObject({ ok: true, result: { open: false, changed: true } })
    expect(setDashboardPopoutOpen).toHaveBeenNthCalledWith(1, true)
    expect(setDashboardPopoutOpen).toHaveBeenNthCalledWith(2, true)
    expect(setDashboardPopoutOpen).toHaveBeenNthCalledWith(3, false)
  })
})
