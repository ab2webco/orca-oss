import { describe, expect, it, vi } from 'vitest'
import { createEditorTabsStore } from './editor-slice-test-harness'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('openGameArcadeTab', () => {
  it('opens one Arcade tab per worktree and starts a fresh run on every saved play', () => {
    const store = createEditorTabsStore()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    store.getState().openGameArcadeTab('wt-1')
    now.mockReturnValue(2000)
    store.getState().openGameArcadeTab('wt-1')
    const arcade = store.getState().openFiles.filter((file) => file.mode === 'arcade')
    expect(arcade).toHaveLength(1)
    expect(arcade[0]?.arcadeRunId).toBe(2000)
    expect(store.getState().activeTabTypeByWorktree['wt-1']).toBe('editor')
    now.mockRestore()
  })
})
