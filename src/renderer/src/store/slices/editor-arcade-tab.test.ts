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

  it('keeps the engine a play asked for, and picks a built-in one when none is given', () => {
    const store = createEditorTabsStore()
    store.getState().openGameArcadeTab('wt-1', 'snake')
    const arcadeOf = () => store.getState().openFiles.find((file) => file.mode === 'arcade')
    expect(arcadeOf()?.arcadeEngine).toBe('snake')
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0)
    store.getState().openGameArcadeTab('wt-1')
    expect(arcadeOf()?.arcadeEngine).toBe('runner')
    roll.mockRestore()
  })
})
