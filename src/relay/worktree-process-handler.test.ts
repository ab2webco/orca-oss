import { describe, expect, it, vi } from 'vitest'
import type { MethodHandler, RequestContext } from './dispatcher'

const { listMock } = vi.hoisted(() => ({
  listMock: vi.fn(async () => ({
    supported: true,
    root: '/w',
    processes: [],
    stopped: [],
    protected: []
  }))
}))

vi.mock('../main/pty/worktree-process-control', () => ({
  listWorktreeProcesses: listMock
}))

import { WorktreeProcessHandler } from './worktree-process-handler'

function captureHandler(): MethodHandler {
  let handler: MethodHandler | undefined
  new WorktreeProcessHandler({
    onRequest: (method, next) => {
      expect(method).toBe('processes.listInRoot')
      handler = next
    }
  })
  if (!handler) {
    throw new Error('handler not registered')
  }
  return handler
}

const context = {} as RequestContext

describe('WorktreeProcessHandler', () => {
  it('lists on the relay host, stopping only when asked', async () => {
    const handler = captureHandler()
    await handler({ root: '/w', stop: true }, context)
    await handler({ root: '/w', stop: 'yes' }, context)
    expect(listMock).toHaveBeenNthCalledWith(1, '/w', { stop: true })
    expect(listMock).toHaveBeenNthCalledWith(2, '/w', { stop: false })
  })

  it('rejects a request without a root', async () => {
    await expect(captureHandler()({}, context)).rejects.toThrow('requires a root path')
  })
})
