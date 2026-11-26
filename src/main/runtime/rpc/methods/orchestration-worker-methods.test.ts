import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { ORCHESTRATION_WORKER_METHODS } from './orchestration-worker-methods'

const handlerOf = (name: string) => {
  const method = ORCHESTRATION_WORKER_METHODS.find((one) => one.name === name)
  if (!method) {
    throw new Error(`${name} is not registered`)
  }
  return method.handler
}

describe('worker lifecycle methods and the game fleet (ORCA-1441)', () => {
  // Why: a start into an existing worktree bumps nothing else, so the open Team panel waited 20 s.
  it.each([
    'orchestration.workerStart',
    'orchestration.workerStop',
    'orchestration.workerDetach',
    'orchestration.workerRelease'
  ])('%s notes a fleet change even when it refuses', async (name) => {
    const noteGameFleetChanged = vi.fn()
    const runtime = {
      noteGameFleetChanged,
      getOrchestrationDb: () => {
        throw new Error('no database here')
      }
    }

    await expect(
      Promise.resolve().then(() => handlerOf(name)({}, { runtime } as unknown as RpcContext))
    ).rejects.toThrow()

    expect(noteGameFleetChanged).toHaveBeenCalledTimes(1)
  })

  it.each([
    'orchestration.workerStartOutcome',
    'orchestration.workerList',
    'orchestration.workerTerminalUserInput'
  ])('%s leaves the fleet alone', async (name) => {
    const noteGameFleetChanged = vi.fn()
    const runtime = {
      noteGameFleetChanged,
      getOrchestrationDb: () => {
        throw new Error('no database here')
      }
    }

    await Promise.resolve()
      .then(() => handlerOf(name)({}, { runtime } as unknown as RpcContext))
      .catch(() => undefined)

    expect(noteGameFleetChanged).not.toHaveBeenCalled()
  })
})
