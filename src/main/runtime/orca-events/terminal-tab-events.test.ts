import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionClientTab } from '../../../shared/runtime-types'
import { TerminalTabEventTracker } from './terminal-tab-events'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function terminalTab(
  parentTabId: string,
  leafId: string,
  title: string
): RuntimeMobileSessionClientTab {
  return {
    type: 'terminal',
    id: `${parentTabId}::${leafId}`,
    title,
    parentTabId,
    leafId,
    isActive: false
  } as RuntimeMobileSessionClientTab
}

function browserTab(id: string): RuntimeMobileSessionClientTab {
  return { type: 'browser', id, title: 'web' } as RuntimeMobileSessionClientTab
}

const handleOf = (paneKey: string): string | null => `h(${paneKey})`

describe('TerminalTabEventTracker', () => {
  it('emits nothing for the baseline it is seeded with', () => {
    const tracker = new TerminalTabEventTracker(handleOf)
    tracker.seed('wt-1', [terminalTab('tab1', LEAF_A, 'zsh')])
    expect(tracker.update('wt-1', [terminalTab('tab1', LEAF_A, 'zsh')], 5)).toEqual([])
  })

  it('reports created, renamed and closed terminal panes, ignoring other tab types', () => {
    const tracker = new TerminalTabEventTracker(handleOf)
    tracker.seed('wt-1', [terminalTab('tab1', LEAF_A, 'zsh'), browserTab('b1')])

    const events = tracker.update(
      'wt-1',
      [terminalTab('tab1', LEAF_A, 'claude'), terminalTab('tab2', LEAF_B, 'zsh')],
      7
    )

    expect(events).toEqual([
      {
        name: 'terminal.title.changed',
        at: 7,
        worktreeId: 'wt-1',
        terminal: `h(tab1:${LEAF_A})`,
        payload: {
          tabId: 'tab1',
          leafId: LEAF_A,
          paneKey: `tab1:${LEAF_A}`,
          title: 'claude',
          previousTitle: 'zsh'
        }
      },
      {
        name: 'terminal.created',
        at: 7,
        worktreeId: 'wt-1',
        terminal: `h(tab2:${LEAF_B})`,
        payload: { tabId: 'tab2', leafId: LEAF_B, paneKey: `tab2:${LEAF_B}`, title: 'zsh' }
      }
    ])

    expect(tracker.update('wt-1', [terminalTab('tab2', LEAF_B, 'zsh')], 9)).toEqual([
      {
        name: 'terminal.closed',
        at: 9,
        worktreeId: 'wt-1',
        terminal: `h(tab1:${LEAF_A})`,
        payload: { tabId: 'tab1', leafId: LEAF_A, paneKey: `tab1:${LEAF_A}`, title: 'claude' }
      }
    ])
  })

  it('treats a worktree it never saw as new, and keeps worktrees apart', () => {
    const tracker = new TerminalTabEventTracker(handleOf)
    tracker.seed('wt-1', [terminalTab('tab1', LEAF_A, 'zsh')])
    const events = tracker.update('wt-2', [terminalTab('tab1', LEAF_A, 'zsh')], 3)
    expect(events.map((event) => [event.name, event.worktreeId])).toEqual([
      ['terminal.created', 'wt-2']
    ])
  })

  it('reports the handle a closed pane had, since the runtime no longer resolves it', () => {
    const live = new Set([`tab1:${LEAF_A}`])
    const tracker = new TerminalTabEventTracker((paneKey) => (live.has(paneKey) ? 'term_a' : null))
    tracker.update('wt-1', [terminalTab('tab1', LEAF_A, 'zsh')], 1)
    live.clear()
    const [closed] = tracker.update('wt-1', [], 2)
    expect(closed).toMatchObject({ name: 'terminal.closed', terminal: 'term_a' })
  })

  it('keeps a pane whose leaf id is not a stable pane id, without a paneKey', () => {
    const tracker = new TerminalTabEventTracker(() => null)
    const [created] = tracker.update('wt-1', [terminalTab('tab1', 'legacy-leaf', 'zsh')], 1)
    expect(created).toMatchObject({
      name: 'terminal.created',
      terminal: null,
      payload: { paneKey: null }
    })
  })
})
