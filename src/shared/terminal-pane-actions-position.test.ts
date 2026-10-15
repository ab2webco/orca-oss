import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import {
  DEFAULT_TERMINAL_PANE_ACTIONS_POSITION,
  composeTerminalPaneActionsPosition,
  resolveTerminalPaneActionsPosition,
  splitTerminalPaneActionsPosition
} from './terminal-pane-actions-position'

describe('terminal pane actions position', () => {
  it('defaults new settings to bottom-right', () => {
    expect(DEFAULT_TERMINAL_PANE_ACTIONS_POSITION).toBe('bottom-right')
    expect(getDefaultSettings('/home/user').terminalPaneActionsPosition).toBe('bottom-right')
  })

  it('keeps every supported position', () => {
    for (const position of [
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right'
    ] as const) {
      expect(resolveTerminalPaneActionsPosition(position)).toBe(position)
    }
  })

  it('falls back to the default for a missing or unknown value', () => {
    expect(resolveTerminalPaneActionsPosition(undefined)).toBe('bottom-right')
    expect(resolveTerminalPaneActionsPosition('middle')).toBe('bottom-right')
    expect(resolveTerminalPaneActionsPosition(3)).toBe('bottom-right')
  })

  it('splits into edge and alignment and composes back', () => {
    expect(splitTerminalPaneActionsPosition('top-center')).toEqual({
      edge: 'top',
      align: 'center'
    })
    expect(composeTerminalPaneActionsPosition('bottom', 'left')).toBe('bottom-left')
  })
})
