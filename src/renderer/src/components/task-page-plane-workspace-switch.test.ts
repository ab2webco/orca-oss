import { describe, expect, it, vi } from 'vitest'

import { runPlaneWorkspaceSwitch } from './task-page-plane-workspace-switch'

describe('runPlaneWorkspaceSwitch', () => {
  // The real bug: selectPlaneWorkspace resolves (not rejects) without
  // touching planeStatus when its mutation generation is superseded. A
  // catch-only chain never observes that as a failure, so loading stayed
  // true forever. This is the control this whole fix exists for.
  it('clears loading even when the switch resolves silently (a superseded selectPlaneWorkspace call)', async () => {
    const setLoading = vi.fn()
    const onFailure = vi.fn()

    await runPlaneWorkspaceSwitch({
      switchWorkspace: () => Promise.resolve(),
      onFailure,
      setLoading
    })

    expect(setLoading.mock.calls).toEqual([[true], [false]])
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('reports the failure and still clears loading when the switch rejects', async () => {
    const setLoading = vi.fn()
    const onFailure = vi.fn()

    await runPlaneWorkspaceSwitch({
      switchWorkspace: () => Promise.reject(new Error('boom')),
      onFailure,
      setLoading
    })

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(setLoading.mock.calls).toEqual([[true], [false]])
  })
})
