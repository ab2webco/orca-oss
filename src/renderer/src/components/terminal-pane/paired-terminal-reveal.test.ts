import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revealPairedTerminal } from './paired-terminal-reveal'

const mocks = vi.hoisted(() => ({
  focus: vi.fn<(handle: string, environmentId?: string | null) => boolean>(),
  call: vi.fn(),
  activate: vi.fn(),
  toastError: vi.fn(),
  listeners: [] as (() => void)[]
}))

vi.mock('./terminal-handle-links', () => ({ focusRendererTerminalHandle: mocks.focus }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.call }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: mocks.activate }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/store', () => ({
  useAppStore: {
    subscribe: (listener: () => void) => {
      mocks.listeners.push(listener)
      return () => mocks.listeners.splice(mocks.listeners.indexOf(listener), 1)
    }
  }
}))

const target = { environmentId: 'env-imac', handle: 'term_839' }

// Why: View on a live remote member opens its host's terminal in this window (ORCA-839).
describe("revealing a paired host's terminal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.length = 0
  })

  it('focuses the terminal when this window already mirrors it', async () => {
    mocks.focus.mockReturnValue(true)
    await expect(revealPairedTerminal(target)).resolves.toBe(true)
    expect(mocks.focus).toHaveBeenCalledWith('term_839', 'env-imac')
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it("opens the host's worktree, then focuses the terminal once its tabs mirror in", async () => {
    mocks.focus.mockReturnValue(false)
    mocks.call.mockResolvedValue({ terminal: { worktreeId: 'repo::/home/me/orca-839' } })
    mocks.activate.mockReturnValue({ primaryTabId: null })

    const revealed = revealPairedTerminal(target)
    await vi.waitFor(() => expect(mocks.listeners).toHaveLength(1))
    mocks.focus.mockReturnValue(true)
    mocks.listeners[0]!()

    await expect(revealed).resolves.toBe(true)
    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-imac' },
      'terminal.show',
      { terminal: 'term_839' }
    )
    expect(mocks.activate).toHaveBeenCalledWith('repo::/home/me/orca-839', {
      executionHostId: 'runtime:env-imac'
    })
    expect(mocks.listeners).toHaveLength(0)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  // Why: focusing sets store state, and the store notifies its listeners synchronously.
  it('focuses once when the focus itself notifies the store', async () => {
    mocks.focus.mockReturnValue(false)
    mocks.call.mockResolvedValue({ terminal: { worktreeId: 'repo::/home/me/orca-839' } })
    mocks.activate.mockReturnValue({ primaryTabId: null })

    const revealed = revealPairedTerminal(target)
    await vi.waitFor(() => expect(mocks.listeners).toHaveLength(1))
    mocks.focus.mockImplementation(() => {
      for (const listener of mocks.listeners) {
        listener()
      }
      return true
    })
    mocks.listeners[0]!()

    await expect(revealed).resolves.toBe(true)
    expect(mocks.focus).toHaveBeenCalledTimes(2)
    expect(mocks.listeners).toHaveLength(0)
  })

  it('says the host did not answer or no longer has the terminal', async () => {
    mocks.focus.mockReturnValue(false)
    mocks.call.mockRejectedValue(new Error('terminal_gone'))
    await expect(revealPairedTerminal(target)).resolves.toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Could not open the member's terminal on its host",
      { description: 'terminal_gone' }
    )
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  // Why: the host answers a released member's handle with a bare code the owner cannot act on.
  it('says the host no longer has the terminal instead of its error code', async () => {
    mocks.focus.mockReturnValue(false)
    mocks.call.mockRejectedValue(
      Object.assign(new Error('terminal_handle_stale'), { code: 'terminal_handle_stale' })
    )
    await expect(revealPairedTerminal(target)).resolves.toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Could not open the member's terminal on its host",
      {
        description:
          'The host no longer has this terminal; the member may have finished or been released.'
      }
    )
  })

  it("says the host's repository is not in this window", async () => {
    mocks.focus.mockReturnValue(false)
    mocks.call.mockResolvedValue({ terminal: { worktreeId: 'repo::/home/me/orca-839' } })
    mocks.activate.mockReturnValue(false)
    await expect(revealPairedTerminal(target)).resolves.toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Could not open the member's terminal on its host",
      { description: "Add the host's repository to this window to open its terminals." }
    )
  })

  it('gives up when the terminal never mirrors in', async () => {
    vi.useFakeTimers()
    try {
      mocks.focus.mockReturnValue(false)
      mocks.call.mockResolvedValue({ terminal: { worktreeId: 'repo::/home/me/orca-839' } })
      mocks.activate.mockReturnValue({ primaryTabId: null })
      const revealed = revealPairedTerminal(target)
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(revealed).resolves.toBe(false)
      expect(mocks.listeners).toHaveLength(0)
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not open the member's terminal on its host",
        { description: 'Its worktree is open, but the terminal has not appeared in this window.' }
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
