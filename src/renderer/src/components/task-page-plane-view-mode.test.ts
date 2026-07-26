import { describe, expect, it } from 'vitest'
import { resolvePlaneViewMode } from './task-page-plane-view-mode'

const PROJECT = 'e665c0d5-22e7-495e-9ecf-3effee3ae370'

describe('resolvePlaneViewMode', () => {
  it('opens on the board when nothing was chosen yet', () => {
    // Why board by default: with agents moving work in parallel, the kanban shows
    // the state of everything at a glance.
    expect(resolvePlaneViewMode({ preference: undefined, projectSelection: PROJECT })).toBe('board')
  })

  it('honours a saved list preference', () => {
    expect(resolvePlaneViewMode({ preference: 'list', projectSelection: PROJECT })).toBe('list')
  })

  it('honours a saved board preference', () => {
    expect(resolvePlaneViewMode({ preference: 'board', projectSelection: PROJECT })).toBe('board')
  })

  it('falls back to the list while every project is in scope', () => {
    // Why: the board builds columns from one project's states, so it is disabled
    // for 'all' — rendering it there would show an empty pane.
    expect(resolvePlaneViewMode({ preference: 'board', projectSelection: 'all' })).toBe('list')
    expect(resolvePlaneViewMode({ preference: undefined, projectSelection: 'all' })).toBe('list')
  })

  it('keeps the board preference intact so narrowing the scope restores it', () => {
    // The fallback is a render-time decision, never a rewrite of what the user chose.
    const preference = 'board' as const
    expect(resolvePlaneViewMode({ preference, projectSelection: 'all' })).toBe('list')
    expect(resolvePlaneViewMode({ preference, projectSelection: PROJECT })).toBe('board')
  })
})

describe('planeViewMode persistence contract', () => {
  it('normalizes an unknown stored value to the board default', async () => {
    // Why asserted against the source: the normalizer is main-side and the default
    // must not drift from what the renderer seeds itself with.
    const { readFileSync } = await import('node:fs')
    const persistence = readFileSync('src/main/persistence.ts', 'utf-8')
    expect(persistence).toContain("return value === 'list' ? 'list' : 'board'")
    expect(persistence).toContain('planeViewMode: normalizePlaneViewMode(')

    const taskPage = readFileSync('src/renderer/src/components/TaskPage.tsx', 'utf-8')
    expect(taskPage).toContain("settings?.planeViewMode ?? 'board'")
    expect(taskPage).toContain('void updateSettings({ planeViewMode: value })')
  })
})
