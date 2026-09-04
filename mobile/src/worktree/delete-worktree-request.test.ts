import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { runWorktreeDelete } from './delete-worktree-request'

const META = { runtimeId: 'runtime-1' }

function requestWith(sendRequest: (method: string, params?: unknown) => Promise<RpcResponse>) {
  const onRollback = vi.fn()
  const notifyFailure = vi.fn()
  return {
    onRollback,
    notifyFailure,
    run: () => runWorktreeDelete({ sendRequest, worktreeId: 'wt-1', onRollback, notifyFailure })
  }
}

describe('runWorktreeDelete', () => {
  it('sends worktree.rm for the id and stays quiet on success', async () => {
    const sendRequest = vi
      .fn<(method: string, params?: unknown) => Promise<RpcResponse>>()
      .mockResolvedValue({ id: 'rm', ok: true, result: null, _meta: META })
    const request = requestWith(sendRequest)

    await expect(request.run()).resolves.toBe('deleted')

    expect(sendRequest).toHaveBeenCalledWith('worktree.rm', { worktree: 'id:wt-1', force: true })
    expect(request.onRollback).not.toHaveBeenCalled()
    expect(request.notifyFailure).not.toHaveBeenCalled()
  })

  it('rolls back and shows the host message when the host refuses', async () => {
    const request = requestWith(async () => ({
      id: 'rm',
      ok: false,
      error: { code: 'busy', message: 'Worktree has running agents' },
      _meta: META
    }))

    await expect(request.run()).resolves.toBe('refused')

    expect(request.onRollback).toHaveBeenCalledOnce()
    expect(request.notifyFailure).toHaveBeenCalledWith(
      'Could not delete worktree',
      'Worktree has running agents'
    )
  })

  it('falls back to a generic message when the refusal carries none', async () => {
    const request = requestWith(async () => ({
      id: 'rm',
      ok: false,
      error: { code: 'internal', message: '' },
      _meta: META
    }))

    await request.run()

    expect(request.notifyFailure).toHaveBeenCalledWith(
      'Could not delete worktree',
      'Please try again.'
    )
  })

  it('rolls back and notifies when the request throws', async () => {
    const request = requestWith(async () => {
      throw new Error('Connection lost')
    })

    await expect(request.run()).resolves.toBe('failed')

    expect(request.onRollback).toHaveBeenCalledOnce()
    expect(request.notifyFailure).toHaveBeenCalledWith(
      'Could not delete worktree',
      'Please try again.'
    )
  })
})
