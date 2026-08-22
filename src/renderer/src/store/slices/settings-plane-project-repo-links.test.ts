import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type { AppState } from '../types'

// Split out of settings.test.ts: the runtime-switching cases there need the full
// runtime RPC harness, and these two only need the settings write.
const settingsSet = vi.fn().mockResolvedValue(undefined)
const settingsGet = vi.fn().mockResolvedValue({ notifications: {} })

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  settingsGet.mockResolvedValue({ notifications: {} })
  vi.stubGlobal('window', {
    api: { settings: { get: settingsGet, set: settingsSet } }
  })
})

describe('setPlaneProjectRepoLink', () => {
  it('persists the Plane project→repo link, merged with existing links', () => {
    const store = createTestStore()
    store.setState({
      settings: {
        planeProjectRepoLinks: { 'plane-a': 'repo-a' }
      } as unknown as AppState['settings']
    })

    store.getState().setPlaneProjectRepoLink('plane-b', 'repo-b')

    expect(settingsSet).toHaveBeenCalledWith({
      planeProjectRepoLinks: { 'plane-a': 'repo-a', 'plane-b': 'repo-b' }
    })
  })

  it('is a no-op when the project already maps to the same repo', () => {
    const store = createTestStore()
    store.setState({
      settings: {
        planeProjectRepoLinks: { 'plane-a': 'repo-a' }
      } as unknown as AppState['settings']
    })

    store.getState().setPlaneProjectRepoLink('plane-a', 'repo-a')

    expect(settingsSet).not.toHaveBeenCalled()
  })
})
