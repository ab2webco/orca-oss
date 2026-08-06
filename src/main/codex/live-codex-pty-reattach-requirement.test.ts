import { afterEach, describe, expect, it, vi } from 'vitest'
import { requiresLiveCodexPtyReattach } from './live-codex-pty-reattach-requirement'
import {
  _internals,
  attachDirectedCodexPtyPersistence,
  confirmSeededDirectedCodexPtyBindings,
  markDirectedCodexPtySpawned,
  releaseDirectedCodexPtyBinding,
  seedDirectedCodexPtyBindingsFromPersistence
} from './directed-codex-pty-binding'

const SESSION_ID = 'repo1::/w/one@@0a1b2c3d'
const ACCOUNT_ID = 'acct_codex_worker'

afterEach(() => {
  _internals.reset()
})

describe('requiresLiveCodexPtyReattach', () => {
  it('requires reattach for a directed session a daemon still hosts', () => {
    seedDirectedCodexPtyBindingsFromPersistence([{ sessionId: SESSION_ID, accountId: ACCOUNT_ID }])
    confirmSeededDirectedCodexPtyBindings([SESSION_ID])
    expect(requiresLiveCodexPtyReattach(SESSION_ID)).toBe(true)
  })

  it('requires reattach for a directed session spawned in this run', () => {
    markDirectedCodexPtySpawned(SESSION_ID, ACCOUNT_ID)
    expect(requiresLiveCodexPtyReattach(SESSION_ID)).toBe(true)
  })

  // Why: the reconciled-away case is exactly cold restore; forcing reattach
  // there would turn every restored Codex pane into a spawn failure.
  it('does not require reattach once no daemon hosts the session', () => {
    const persistence = {
      addCodexDirectedPtyAccountBinding: vi.fn(),
      removeCodexDirectedPtyAccountBinding: vi.fn()
    }
    attachDirectedCodexPtyPersistence(persistence)
    seedDirectedCodexPtyBindingsFromPersistence([{ sessionId: SESSION_ID, accountId: ACCOUNT_ID }])
    confirmSeededDirectedCodexPtyBindings([])
    expect(requiresLiveCodexPtyReattach(SESSION_ID)).toBe(false)
    // Why: a phantom left on disk would re-assert itself on the next launch.
    expect(persistence.removeCodexDirectedPtyAccountBinding).toHaveBeenCalledWith(SESSION_ID)
  })

  // Why: this is the direction that keeps the gate narrow — a pane that merely
  // inherited the current Codex selection was never account-directed.
  it('never requires reattach for a session with no directed binding', () => {
    expect(requiresLiveCodexPtyReattach(SESSION_ID)).toBe(false)
  })

  it('never requires reattach for a fresh create with no session id', () => {
    expect(requiresLiveCodexPtyReattach(undefined)).toBe(false)
  })

  it('stops requiring reattach once the binding is released', () => {
    const persistence = {
      addCodexDirectedPtyAccountBinding: vi.fn(),
      removeCodexDirectedPtyAccountBinding: vi.fn()
    }
    attachDirectedCodexPtyPersistence(persistence)
    markDirectedCodexPtySpawned(SESSION_ID, ACCOUNT_ID)
    releaseDirectedCodexPtyBinding(SESSION_ID)
    expect(requiresLiveCodexPtyReattach(SESSION_ID)).toBe(false)
    expect(persistence.removeCodexDirectedPtyAccountBinding).toHaveBeenCalledWith(SESSION_ID)
  })
})
