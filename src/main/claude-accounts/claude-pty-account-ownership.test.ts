import { describe, expect, it } from 'vitest'
import {
  resolveClaudePtyAccountOwnership,
  resolveClaudeTerminalAccountReport,
  type ClaudePtyAccountBindingReader
} from './claude-pty-account-ownership'

function reader(
  overrides: Partial<ClaudePtyAccountBindingReader> = {}
): ClaudePtyAccountBindingReader {
  return {
    getInjectedAccountId: () => null,
    isSharedPty: () => false,
    isUnknownOwnerSharedPty: () => false,
    getSharedAccountId: () => null,
    findAccountEmail: () => null,
    ...overrides
  }
}

describe('resolveClaudePtyAccountOwnership', () => {
  it('reports the pinned account a launch bound to the pane', () => {
    expect(
      resolveClaudePtyAccountOwnership(
        'pty-1',
        reader({
          getInjectedAccountId: () => 'account-fabiana',
          findAccountEmail: (id) => (id === 'account-fabiana' ? 'fabiana@example.com' : null)
        })
      )
    ).toEqual({
      state: 'account',
      accountId: 'account-fabiana',
      email: 'fabiana@example.com',
      pinned: true
    })
  })

  it('reports a shared PTY whose managed owner is known as that account, unpinned', () => {
    expect(
      resolveClaudePtyAccountOwnership(
        'pty-1',
        reader({
          isSharedPty: () => true,
          getSharedAccountId: () => 'account-scloud',
          findAccountEmail: () => 'scloud@example.com'
        })
      )
    ).toEqual({
      state: 'account',
      accountId: 'account-scloud',
      email: 'scloud@example.com',
      pinned: false
    })
  })

  it('reports no managed account for a shared PTY with a resolved null owner', () => {
    expect(
      resolveClaudePtyAccountOwnership(
        'pty-1',
        reader({ isSharedPty: () => true, getSharedAccountId: () => null })
      )
    ).toEqual({ state: 'none' })
  })

  it('reports unknown, not none, when a shared PTY owner is unresolved', () => {
    // Why this is the discriminating case: both answers carry a null accountId,
    // and collapsing them is what let "no managed account" stand in for "the
    // runtime does not know" (ORCA-190) — the state ORCA-175 must not guess at.
    expect(
      resolveClaudePtyAccountOwnership(
        'pty-1',
        reader({
          isSharedPty: () => true,
          isUnknownOwnerSharedPty: () => true,
          getSharedAccountId: () => null
        })
      )
    ).toEqual({ state: 'unknown', reason: 'ownership-unresolved' })
  })

  it('reports unknown when the gate holds no Claude binding for the PTY', () => {
    expect(resolveClaudePtyAccountOwnership('pty-1', reader())).toEqual({
      state: 'unknown',
      reason: 'no-claude-binding'
    })
  })

  it('keeps the account id and reports no email when the account was removed', () => {
    // Never substitute another account's label — that is how the wrong identity
    // gets reported as this pane's.
    expect(
      resolveClaudePtyAccountOwnership(
        'pty-1',
        reader({ getInjectedAccountId: () => 'account-gone', findAccountEmail: () => null })
      )
    ).toEqual({ state: 'account', accountId: 'account-gone', email: null, pinned: true })
  })

  it('never consults the global selection: the answer depends only on this PTY', () => {
    const bindings = new Map([['pty-a', 'account-a']])
    const paneReader = reader({
      getInjectedAccountId: (ptyId) => bindings.get(ptyId) ?? null
    })

    expect(resolveClaudePtyAccountOwnership('pty-a', paneReader)).toMatchObject({
      accountId: 'account-a'
    })
    expect(resolveClaudePtyAccountOwnership('pty-b', paneReader)).toEqual({
      state: 'unknown',
      reason: 'no-claude-binding'
    })
  })
})

describe('resolveClaudeTerminalAccountReport', () => {
  it('reports pane-unresolved for a handle with no live pane', () => {
    // A sleeping pane is invisible to the terminal list (ORCA-186); saying so is
    // the honest answer, not naming whatever account is globally selected.
    expect(
      resolveClaudeTerminalAccountReport({
        terminal: 'orca-terminal-4',
        pane: null,
        reader: reader({ getInjectedAccountId: () => 'account-a' })
      })
    ).toEqual({
      terminal: 'orca-terminal-4',
      ptyId: null,
      ownership: { state: 'unknown', reason: 'pane-unresolved' }
    })
  })

  it('reports pane-unresolved for a disconnected record that still has a binding', () => {
    // Why not the binding: a closed pane's record lingers, and answering from it
    // would report a pane that no longer exists as running on that account. A
    // disconnected pane with NO binding is the worse half — it would read as
    // "owns no managed account", asserting something about a pane that is gone.
    expect(
      resolveClaudeTerminalAccountReport({
        terminal: 'orca-terminal-4',
        pane: { ptyId: 'pty-4', connected: false, remote: false },
        reader: reader({ getInjectedAccountId: () => 'account-a' })
      })
    ).toEqual({
      terminal: 'orca-terminal-4',
      ptyId: 'pty-4',
      ownership: { state: 'unknown', reason: 'pane-unresolved' }
    })
  })

  it('reports pane-unresolved for a disconnected record with no binding at all', () => {
    expect(
      resolveClaudeTerminalAccountReport({
        terminal: 'orca-terminal-4',
        pane: { ptyId: 'pty-4', connected: false, remote: false },
        reader: reader()
      }).ownership
    ).toEqual({ state: 'unknown', reason: 'pane-unresolved' })
  })

  it('reports the binding of a pinned pane even on a remote host', () => {
    expect(
      resolveClaudeTerminalAccountReport({
        terminal: 'orca-terminal-4',
        pane: { ptyId: 'pty-4', connected: true, remote: true },
        reader: reader({
          getInjectedAccountId: () => 'account-a',
          findAccountEmail: () => 'a@example.com'
        })
      })
    ).toEqual({
      terminal: 'orca-terminal-4',
      ptyId: 'pty-4',
      ownership: { state: 'account', accountId: 'account-a', email: 'a@example.com', pinned: true }
    })
  })

  it('reports remote-host rather than none for an unbound remote pane', () => {
    // Why not `none`: a WSL/SSH Claude authenticates inside that host, so the
    // absence of a binding here proves nothing about what it runs on.
    expect(
      resolveClaudeTerminalAccountReport({
        terminal: 'orca-terminal-4',
        pane: { ptyId: 'pty-4', connected: true, remote: true },
        reader: reader({ isSharedPty: () => true })
      })
    ).toEqual({
      terminal: 'orca-terminal-4',
      ptyId: 'pty-4',
      ownership: { state: 'unknown', reason: 'remote-host' }
    })
  })

  it('reports a local unbound pane as no managed account', () => {
    expect(
      resolveClaudeTerminalAccountReport({
        terminal: 'orca-terminal-4',
        pane: { ptyId: 'pty-4', connected: true, remote: false },
        reader: reader({ isSharedPty: () => true })
      })
    ).toEqual({
      terminal: 'orca-terminal-4',
      ptyId: 'pty-4',
      ownership: { state: 'none' }
    })
  })
})
