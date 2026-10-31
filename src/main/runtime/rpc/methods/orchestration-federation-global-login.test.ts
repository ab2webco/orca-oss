import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GlobalLogin from './orchestration-federation-global-login'

let claimFederatedGlobalLogin: typeof GlobalLogin.claimFederatedGlobalLogin

// Why fresh: the claims of a start still in flight live in the module.
beforeEach(async () => {
  vi.resetModules()
  ;({ claimFederatedGlobalLogin } = await import('./orchestration-federation-global-login'))
})

function hostWith(states: Record<string, string>, live: string[] = []) {
  return {
    federatedMembersOnGlobalLogin: async () => live,
    getOrchestrationDb: () =>
      ({
        getRemoteDispatchAttachment: (id: string) =>
          states[id] === undefined ? undefined : { state: states[id] }
      }) as never
  }
}

describe("a host's global login takes one federated member at a time (ORCA-891)", () => {
  it('refuses while a live member holds it, naming that member', async () => {
    await expect(
      claimFederatedGlobalLogin({
        runtime: hostWith({}, ['Ana · CIN-11']),
        dispatchId: 'ctx_live',
        provider: 'claude'
      })
    ).rejects.toMatchObject({
      code: 'global_login_taken',
      message: expect.stringContaining('Ana · CIN-11')
    })
  })

  it('refuses a second start while the first is still starting, and frees it once that settles', async () => {
    const states: Record<string, string> = {}
    const runtime = hostWith(states)
    await claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_a', provider: 'claude' })
    states.ctx_a = 'starting'

    await expect(
      claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_b', provider: 'claude' })
    ).rejects.toMatchObject({ message: expect.stringContaining('ctx_a') })
    // Why: a durable retry of the same start must not refuse itself.
    await claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_a', provider: 'claude' })
    // Why another provider: Codex keeps its own global login.
    await claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_codex', provider: 'codex' })

    states.ctx_a = 'failed'
    states.ctx_codex = 'failed'
    await claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_b', provider: 'claude' })
  })

  it('drops a claim whose attachment never appeared after a while', async () => {
    const runtime = hostWith({})
    const now = Date.parse('2026-10-30T12:00:00Z')
    await claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_lost', provider: 'claude', now })

    await expect(
      claimFederatedGlobalLogin({ runtime, dispatchId: 'ctx_next', provider: 'claude', now })
    ).rejects.toMatchObject({ code: 'global_login_taken' })
    await claimFederatedGlobalLogin({
      runtime,
      dispatchId: 'ctx_next',
      provider: 'claude',
      now: now + 121_000
    })
  })
})
