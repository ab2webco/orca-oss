import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

// Why: View on a remote member must open its host's terminal in this window, not focus a local handle (ORCA-839).
describe("opening a paired host's terminal in this window", () => {
  const runtimeWith = () => {
    const resolve = vi.fn(() => ({
      environmentId: 'env-imac',
      name: 'imac',
      peerFingerprint: 'fp'
    }))
    const call = vi.fn()
    const runtime = new OrcaRuntimeService(null, undefined, {
      orchestrationEnvironmentTransport: { resolve, call }
    })
    return { runtime, resolve, call }
  }

  it('asks the window to reveal the terminal on the host the selector names', async () => {
    const { runtime, resolve, call } = runtimeWith()
    const revealPairedTerminal = vi.fn()
    runtime.setNotifier({ revealPairedTerminal } as never)

    await expect(runtime.revealPairedTerminal('imac', 'term_839')).resolves.toEqual({
      handle: 'term_839',
      environmentId: 'env-imac',
      host: 'imac',
      navigated: true
    })

    expect(resolve).toHaveBeenCalledWith('imac')
    expect(revealPairedTerminal).toHaveBeenCalledWith({
      environmentId: 'env-imac',
      handle: 'term_839'
    })
    // Why: the window reads the host itself; this runtime never relays the terminal.
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses when no window can show the terminal, as under orca serve', async () => {
    const { runtime } = runtimeWith()
    runtime.setNotifier({} as never)
    await expect(runtime.revealPairedTerminal('imac', 'term_839')).rejects.toThrow(
      'runtime_unavailable'
    )
  })

  it('refuses when this runtime has no paired hosts', async () => {
    const runtime = new OrcaRuntimeService(null)
    runtime.setNotifier({ revealPairedTerminal: vi.fn() } as never)
    await expect(runtime.revealPairedTerminal('imac', 'term_839')).rejects.toMatchObject({
      code: 'server_required'
    })
  })
})
