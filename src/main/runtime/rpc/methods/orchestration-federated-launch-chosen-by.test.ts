import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { federatedLaunchParamsOf } from './orchestration-federated-launch-chosen-by'
import type { WorkerStartInput } from './orchestration-worker-start-schema'

const params: WorkerStartInput = {
  task: 't',
  from: 'f',
  on: 'm1',
  agent: 'claude',
  model: 'claude-opus-5-5',
  effort: 'high',
  modelChosenBy: { by: 'lead', kind: 'implement', source: 'flag' }
}

describe('federatedLaunchParamsOf (ORCA-851)', () => {
  it("hands the lead's default to a host that launches it unpinned", () => {
    expect(
      federatedLaunchParamsOf(params, [
        ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
        ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY
      ])
    ).toEqual(params)
  })

  // Why: an older host would pin it (locking Jev out) or refuse a model it cannot launch.
  it('starts the member on its default on an older host, as before', () => {
    const sent = federatedLaunchParamsOf(params, [
      ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
    ])
    expect(sent).not.toHaveProperty('model')
    expect(sent).not.toHaveProperty('effort')
    expect(sent).not.toHaveProperty('modelChosenBy')
    expect(sent.agent).toBe('claude')
  })

  it("keeps a person's model whatever the host", () => {
    const typed = { ...params, modelChosenBy: undefined }
    expect(federatedLaunchParamsOf(typed, [])).toEqual(typed)
  })
})
