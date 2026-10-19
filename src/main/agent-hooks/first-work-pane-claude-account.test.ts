import { describe, expect, it, vi } from 'vitest'
import { resolvePaneClaudeAccountId } from './first-work-pane-claude-account'

const PANE_KEY = 'tab-1:leaf-1'

function makeLookup(owner: { known: boolean; accountId: string | null }) {
  return {
    getPtyIdForPaneKey: vi.fn((paneKey: string) => (paneKey === PANE_KEY ? 'pty-1' : null)),
    getManagedPtyAccountOwner: vi.fn(() => ({ ...owner, customEndpoint: false }))
  }
}

describe('resolvePaneClaudeAccountId', () => {
  it('returns the Claude account the pane PTY runs on', () => {
    const lookup = makeLookup({ known: true, accountId: 'acct-pane' })
    expect(resolvePaneClaudeAccountId(PANE_KEY, lookup)).toBe('acct-pane')
    expect(lookup.getManagedPtyAccountOwner).toHaveBeenCalledWith('pty-1', 'claude')
  })

  it('returns null when the pane has no live PTY', () => {
    const lookup = makeLookup({ known: true, accountId: 'acct-pane' })
    expect(resolvePaneClaudeAccountId('tab-9:leaf-9', lookup)).toBeNull()
    expect(lookup.getManagedPtyAccountOwner).not.toHaveBeenCalled()
  })

  it('returns null when the PTY account is unknown', () => {
    const lookup = makeLookup({ known: false, accountId: null })
    expect(resolvePaneClaudeAccountId(PANE_KEY, lookup)).toBeNull()
  })

  it('returns null when the PTY runs on the shared login', () => {
    const lookup = makeLookup({ known: true, accountId: null })
    expect(resolvePaneClaudeAccountId(PANE_KEY, lookup)).toBeNull()
  })
})
