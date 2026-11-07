import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { terminalLayoutWithPtyBinding } from './terminal-layout-pty-ownership'

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'

const layout: TerminalLayoutSnapshot = {
  root: {
    type: 'split',
    direction: 'vertical',
    first: { type: 'leaf', leafId: FIRST },
    second: { type: 'leaf', leafId: SECOND }
  },
  // A snapshot taken while the new split had no PTY falls back to the bound leaf.
  activeLeafId: FIRST,
  expandedLeafId: null,
  ptyIdsByLeafId: { [FIRST]: 'pty-1' }
}

describe('terminalLayoutWithPtyBinding', () => {
  it('hands focus back to the focused pane once its PTY binds', () => {
    const next = terminalLayoutWithPtyBinding(layout, {
      leafId: SECOND,
      ptyId: 'pty-2',
      focusedLeafId: SECOND
    })
    expect(next.activeLeafId).toBe(SECOND)
    expect(next.ptyIdsByLeafId).toEqual({ [FIRST]: 'pty-1', [SECOND]: 'pty-2' })
  })

  it('leaves focus alone when a background pane binds', () => {
    const next = terminalLayoutWithPtyBinding(layout, {
      leafId: SECOND,
      ptyId: 'pty-2',
      focusedLeafId: FIRST
    })
    expect(next.activeLeafId).toBe(FIRST)
  })
})
