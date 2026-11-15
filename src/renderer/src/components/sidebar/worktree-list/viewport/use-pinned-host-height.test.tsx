// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PINNED_HOST_HEIGHT_VARIABLE, usePinnedHostHeight } from './use-pinned-host-height'

function scrollRootWithPinnedHost(height: number | null): HTMLDivElement {
  const root = document.createElement('div')
  if (height !== null) {
    const host = document.createElement('div')
    host.setAttribute('data-worktree-sticky-host-active', '')
    host.getBoundingClientRect = () => ({ height }) as DOMRect
    root.append(host)
  }
  document.body.append(root)
  return root
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('usePinnedHostHeight', () => {
  it('publishes the pinned host card height to the handoff ref and the group tier offset', () => {
    const root = scrollRootWithPinnedHost(44)
    const { result } = renderHook(() => usePinnedHostHeight({ current: root }))

    expect(result.current.current).toBe(44)
    expect(root.style.getPropertyValue(PINNED_HOST_HEIGHT_VARIABLE)).toBe('44px')
  })

  it('leaves the fallback in place while no host card is pinned', () => {
    const root = scrollRootWithPinnedHost(null)
    const { result } = renderHook(() => usePinnedHostHeight({ current: root }))

    expect(result.current.current).toBeUndefined()
    expect(root.style.getPropertyValue(PINNED_HOST_HEIGHT_VARIABLE)).toBe('')
  })
})
