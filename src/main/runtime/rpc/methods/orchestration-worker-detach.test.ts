import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_METHODS } from './orchestration'
import type { RpcContext } from '../core'
import { OrchestrationDb } from '../../orchestration/db'
import { isOrchestrationMutation } from '../../../../shared/orchestration-rpc-contract'

const detach = ORCHESTRATION_METHODS.find((one) => one.name === 'orchestration.workerDetach')

function readyWorker(db: OrchestrationDb): string {
  const task = db.createTask({ spec: 'worker' })
  const started = db.createStartingWorkerDispatch({
    taskId: task.id,
    startOptions: { topology: 'current', agent: 'claude' }
  })
  db.prepareStartingWorkerAuthority({
    dispatchId: started.dispatch.id,
    handle: 'term_worker',
    paneKey: 'tab_worker:leaf_worker',
    processIncarnation: 'runtime:pty:1',
    worktreeId: 'repo::worktree',
    setupState: 'not_applicable',
    terminalOwnership: 'created',
    effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }]
  })
  db.markWorkerDispatchReady(started.dispatch.id)
  return started.dispatch.id
}

// Why: ending a member's dispatch must never close the agent's pane (ORCA-943).
describe('orchestration.workerDetach', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
  })

  function contextWith(federated: Record<string, string> | null) {
    db = new OrchestrationDb(':memory:')
    const closeTerminal = vi.fn()
    const notifyMessageArrived = vi.fn()
    const orchestration = db
    const runtime = {
      getOrchestrationDb: () =>
        new Proxy(orchestration, {
          get: (target, key) =>
            key === 'getFederatedDispatch'
              ? () => federated ?? undefined
              : Reflect.get(target, key, target)
        }),
      closeTerminal,
      notifyMessageArrived,
      resolveOrchestrationWorkerServer: () => ({
        environmentId: 'env_m1',
        name: 'm1',
        peerFingerprint: 'peer_m1'
      }),
      // Why: an older host's status has no federation-detach capability.
      callOrchestrationWorkerServer: vi.fn(async () => ({
        appVersion: '1.4.150-lab.110',
        capabilities: []
      }))
    }
    return { db, ctx: { runtime } as unknown as RpcContext, closeTerminal, notifyMessageArrived }
  }

  it('settles a live local dispatch as detached and closes nothing', async () => {
    const { db: d, ctx, closeTerminal, notifyMessageArrived } = contextWith(null)
    const dispatchId = readyWorker(d)

    await expect((async () => detach!.handler({ dispatch: dispatchId }, ctx))()).resolves.toEqual({
      dispatchId,
      state: 'stopped',
      alreadySettled: false,
      processAction: 'none'
    })
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(notifyMessageArrived).toHaveBeenCalledWith(`dispatch:${dispatchId}`, 'status')
    expect(isOrchestrationMutation('orchestration.workerDetach', { dispatch: dispatchId })).toBe(
      true
    )
  })

  it('refuses a dispatch on a paired host, naming the host', async () => {
    const { db: d, ctx } = contextWith({
      environment_name: 'm1',
      environment_id: 'env_m1',
      peer_fingerprint: 'peer_m1'
    })
    const dispatchId = readyWorker(d)

    await expect((async () => detach!.handler({ dispatch: dispatchId }, ctx))()).rejects.toThrow(
      /m1 runs Orca 1\.4\.150-lab\.110, which cannot detach/
    )
    expect(d.getWorkerDispatch(dispatchId)?.state).toBe('ready')
  })
})
