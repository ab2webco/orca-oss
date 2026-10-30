import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcContext } from '../core'
import { ORCHESTRATION_FEDERATION_CONTROL_METHODS } from './orchestration-federation-control'

const show = ORCHESTRATION_FEDERATION_CONTROL_METHODS.find(
  (method) => method.name === 'orchestration.federationShow'
)!

function hostRuntime(exact: boolean) {
  const agentOf = vi.fn(async () => ({
    state: 'working',
    agentType: 'claude',
    updatedAt: 7
  }))
  const runtime = {
    getRuntimeId: () => 'epoch_imac',
    getOrchestrationDb: () => ({
      getRemoteDispatchAttachment: () => ({
        terminal_handle: 'term_817',
        home_peer_fingerprint: 'fp_home',
        effects: '[]',
        residual_resources: '[]'
      }),
      isRemoteAttachmentProcessCurrent: () => exact
    }),
    showTerminal: async () => ({ handle: 'term_817', connected: true }),
    getTerminalPaneKey: () => 'tab:817',
    getTerminalProcessIncarnation: () => 1,
    getFederatedMemberAgent: agentOf
  }
  return { runtime: runtime as unknown as OrcaRuntimeService, agentOf }
}

const call = (runtime: OrcaRuntimeService) =>
  show.handler({ dispatchId: 'ctx_817' }, {
    runtime,
    authenticatedCallerFingerprint: 'fp_home'
  } as RpcContext) as Promise<Record<string, unknown>>

// Why: the home read a settled dispatch as idle while the agent kept working (ORCA-837).
describe('federationShow relays the member agent its hooks report', () => {
  it("sends the exact worker's hook reading", async () => {
    const { runtime, agentOf } = hostRuntime(true)

    const shown = await call(runtime)

    expect(agentOf).toHaveBeenCalledWith('term_817')
    expect(shown.agent).toEqual({
      state: 'working',
      agentType: 'claude',
      updatedAt: 7
    })
  })

  it('sends no reading once the terminal is no longer the worker it attached', async () => {
    const { runtime, agentOf } = hostRuntime(false)

    const shown = await call(runtime)

    expect(agentOf).not.toHaveBeenCalled()
    expect(shown).not.toHaveProperty('agent')
  })
})
