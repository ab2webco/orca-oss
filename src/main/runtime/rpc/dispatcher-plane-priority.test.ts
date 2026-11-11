import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getDefaultUIState } from '../../../shared/constants'
import { currentPlanePriority } from '../../plane/plane-call-priority'
import { RpcDispatcher } from './dispatcher'
import { defineMethod, type RpcRequest } from './core'
import type { OrcaRuntimeService } from '../orca-runtime'

const runtime = {
  getRuntimeId: () => 'test-runtime',
  getUIState: vi.fn(() => getDefaultUIState()),
  recordFeatureInteraction: vi.fn(() => getDefaultUIState()),
  getOrchestrationDb: () => ({
    getLegacyAdoption: () => undefined,
    resolveLegacyWorkerCandidate: () => undefined
  })
} as unknown as OrcaRuntimeService

const priorityMethod = (name: string) =>
  defineMethod({ name, params: z.object({}), handler: () => currentPlanePriority() })

const request = (method: string): RpcRequest => ({ id: 'r', authToken: 't', method, params: {} })

const dispatcher = new RpcDispatcher({
  runtime,
  methods: [priorityMethod('plane.listWorkItems'), priorityMethod('repo.list')]
})

async function streamed(method: string, pairedDeviceId?: string): Promise<unknown> {
  let reply = ''
  await dispatcher.dispatchStreaming(request(method), (one) => (reply = one), { pairedDeviceId })
  return (JSON.parse(reply) as { result?: unknown }).result
}

// ORCA-1166: agents' `orca plane` calls must queue behind the owner's own Plane reads.
describe('Plane call priority by caller', () => {
  it('queues a Plane call from the local CLI as background', async () => {
    expect((await dispatcher.dispatch(request('plane.listWorkItems'))).result).toBe('background')
    expect(await streamed('plane.listWorkItems')).toBe('background')
  })

  it("keeps a paired phone's Plane call interactive", async () => {
    expect(await streamed('plane.listWorkItems', 'device-1')).toBe('interactive')
  })

  it('leaves other methods alone', async () => {
    expect((await dispatcher.dispatch(request('repo.list'))).result).toBe('interactive')
  })
})
