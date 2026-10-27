import { describe, expect, it } from 'vitest'
import {
  getTerminalRecordsFromSessionTabs,
  mergeTerminalListWithKnownRecords,
  mergeTerminalRecordsByCurrentOrder,
  mobileSessionTabsEqual,
  scopeTerminalListToWorktree,
  type MobileTerminalSessionTab,
  type TerminalRecord
} from './mobile-terminal-records'

const lightTheme = {
  mode: 'light' as const,
  theme: {
    background: '#ffffff',
    foreground: '#111111'
  }
}

const darkTheme = {
  mode: 'dark' as const,
  theme: {
    background: '#111111',
    foreground: '#eeeeee'
  }
}

describe('mobile terminal records', () => {
  it('keeps the known theme when a session-tab snapshot omits it', () => {
    const known: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Old title', terminalTheme: darkTheme, isActive: false }
    ]
    const snapshot: TerminalRecord[] = [{ handle: 'pty-1', title: 'Current title', isActive: true }]

    expect(mergeTerminalRecordsByCurrentOrder(snapshot, known)).toEqual([
      { handle: 'pty-1', title: 'Current title', terminalTheme: darkTheme, isActive: true }
    ])
  })

  it('keeps session-tab terminal themes when terminal.list omits them', () => {
    const terminalList: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Terminal', isActive: true },
      { handle: 'pty-2', title: 'Logs', isActive: false }
    ]
    const currentTerminals: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Terminal', terminalTheme: darkTheme, isActive: true }
    ]
    const sessionTabs: MobileTerminalSessionTab[] = [
      {
        type: 'terminal',
        id: 'term-1::leaf-1',
        title: 'Terminal',
        terminal: 'pty-1',
        terminalTheme: lightTheme,
        isActive: true
      }
    ]

    expect(mergeTerminalListWithKnownRecords(terminalList, currentTerminals, sessionTabs)).toEqual([
      { handle: 'pty-1', title: 'Terminal', terminalTheme: lightTheme, isActive: true },
      { handle: 'pty-2', title: 'Logs', isActive: false }
    ])
  })

  it('falls back to the current terminal theme while waiting for session tabs', () => {
    const terminalList: TerminalRecord[] = [{ handle: 'pty-1', title: 'Terminal', isActive: true }]
    const currentTerminals: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Terminal', terminalTheme: darkTheme, isActive: true }
    ]

    expect(mergeTerminalListWithKnownRecords(terminalList, currentTerminals, [])).toEqual([
      { handle: 'pty-1', title: 'Terminal', terminalTheme: darkTheme, isActive: true }
    ])
  })

  it('ignores pending terminal tabs without a handle', () => {
    expect(
      getTerminalRecordsFromSessionTabs([
        {
          type: 'terminal',
          id: 'pending',
          title: 'Terminal',
          terminal: null,
          terminalTheme: lightTheme,
          isActive: true
        }
      ])
    ).toEqual([])
  })

  it('treats a launch draft appearing or retracting as a session-tab change', () => {
    // The route keeps `prev` when these compare equal, so a frame whose only
    // delta is the draft would never reach the chat composer.
    const base: MobileTerminalSessionTab = {
      type: 'terminal',
      id: 'term-1::leaf-1',
      parentTabId: 'term-1',
      leafId: 'leaf-1',
      title: 'Claude',
      status: 'ready',
      terminal: 'pty-1',
      isActive: true
    }
    const seeded: MobileTerminalSessionTab = {
      ...base,
      launchDraft: 'https://github.com/o/r/issues/12',
      launchDraftCreatedAt: 1
    }

    expect(mobileSessionTabsEqual([base], [seeded])).toBe(false)
    expect(mobileSessionTabsEqual([seeded], [base])).toBe(false)
    expect(mobileSessionTabsEqual([seeded], [{ ...seeded }])).toBe(true)
    expect(mobileSessionTabsEqual([seeded], [{ ...seeded, launchDraftCreatedAt: 2 }])).toBe(false)
  })

  it('treats terminal agent-status changes as session-tab changes', () => {
    const base: MobileTerminalSessionTab = {
      type: 'terminal',
      id: 'term-1::leaf-1',
      parentTabId: 'term-1',
      leafId: 'leaf-1',
      title: 'Claude',
      status: 'ready',
      terminal: 'pty-1',
      isActive: true,
      agentStatus: {
        state: 'working',
        prompt: '',
        updatedAt: 1,
        stateStartedAt: 1,
        paneKey: 'term-1:leaf-1',
        terminalHandle: 'pty-1',
        stateHistory: []
      }
    }

    expect(
      mobileSessionTabsEqual(
        [base],
        [
          {
            ...base,
            agentStatus: {
              ...base.agentStatus!,
              state: 'blocked',
              updatedAt: 2,
              stateStartedAt: 2
            }
          }
        ]
      )
    ).toBe(false)
  })
})

describe('scopeTerminalListToWorktree', () => {
  // Why: ids as a host sends them; hosts before the ORCA-811 fix add other worktrees' sleeping agents.
  const worktreeId =
    '8e9e530d-ec22-4e5c-b2fb-10ed00fac102::/Users/me/orca/workspaces/orca-oss/onetab'
  const otherWorktreeId = '8e9e530d-ec22-4e5c-b2fb-10ed00fac102::/Users/me/Projects/whmcs'

  it('drops rows the host listed for another worktree', () => {
    const rows = [
      { handle: 'term_own', title: 'shell', isActive: true, worktreeId },
      { handle: 'term_sleeping', title: 'agent', isActive: false, worktreeId: otherWorktreeId }
    ]

    expect(scopeTerminalListToWorktree(rows, worktreeId).map((row) => row.handle)).toEqual([
      'term_own'
    ])
  })

  it('keeps rows that carry no worktree id', () => {
    const rows = [{ handle: 'term_unscoped', title: 'shell', isActive: true }]

    expect(scopeTerminalListToWorktree(rows, worktreeId)).toEqual(rows)
  })
})
