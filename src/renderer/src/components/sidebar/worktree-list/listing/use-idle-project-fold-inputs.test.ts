// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { useIdleProjectFoldInputs } from './use-idle-project-fold-inputs'

const initialState = useAppStore.getInitialState()

afterEach(() => {
  useAppStore.setState(initialState, true)
})

describe('useIdleProjectFoldInputs', () => {
  it('keeps one identity across agent-status epochs that change no fold input', () => {
    const { result } = renderHook(() => useIdleProjectFoldInputs())
    const first = result.current
    act(() => {
      useAppStore.setState({ agentStatusEpoch: useAppStore.getState().agentStatusEpoch + 1 })
    })
    expect(result.current).toBe(first)
  })

  it('changes identity when the current workspace changes', () => {
    const { result } = renderHook(() => useIdleProjectFoldInputs())
    const first = result.current
    act(() => {
      useAppStore.setState({ activeWorktreeId: 'wt-next', activeWorkspaceKey: 'worktree:wt-next' })
    })
    expect(result.current).not.toBe(first)
    expect(result.current.currentWorktreeId).toBe('wt-next')
  })
})
