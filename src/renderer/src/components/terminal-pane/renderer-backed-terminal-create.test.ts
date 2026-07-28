import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeRendererBackedTerminalCreate,
  failRendererBackedTerminalCreate,
  registerRendererBackedTerminalCreate
} from './renderer-backed-terminal-create'

describe('renderer-backed terminal create lifecycle', () => {
  const reply = vi.fn()
  const closeTab = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports a spawn failure and removes the tab created for the request', () => {
    registerRendererBackedTerminalCreate('tab-failed', 'request-1')

    expect(
      failRendererBackedTerminalCreate('tab-failed', 'managed account is already in use', {
        reply,
        closeTab
      })
    ).toBe(true)
    expect(reply).toHaveBeenCalledWith({
      requestId: 'request-1',
      tabId: 'tab-failed',
      error: 'managed account is already in use'
    })
    expect(closeTab).toHaveBeenCalledWith('tab-failed')
  })

  it('does not retire a successful terminal for a later transport error', () => {
    registerRendererBackedTerminalCreate('tab-ready', 'request-2')
    completeRendererBackedTerminalCreate('tab-ready')

    expect(
      failRendererBackedTerminalCreate('tab-ready', 'later disconnect', { reply, closeTab })
    ).toBe(false)
    expect(reply).not.toHaveBeenCalled()
    expect(closeTab).not.toHaveBeenCalled()
  })
})
