import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { RpcRequest } from './core'
import type { OrcaRuntimeService } from '../orca-runtime'
import { TERMINAL_METHODS } from './methods/terminal'

/**
 * `terminal.send` has two write paths and the difference is not cosmetic: the
 * raw one writes `text\r` as a single payload, while the agent-prompt one frames
 * the text as a bracketed paste and holds the submit CR for
 * AGENT_PROMPT_SUBMIT_DELAY_MS so the CR cannot outrun the TUI composer.
 *
 * The CLI has always asked for the second one, but `agentPrompt` was missing
 * from the params schema, and a zod object strips unknown keys — so the flag was
 * dropped in silence and every `orca terminal send` took the racy path
 * (ORCA-437). These assert the ROUTE, not the `ok`: the response was already
 * `accepted: true` while the prompt sat unsent.
 */
const HANDLE = 'terminal-1'

type SendSpies = {
  sendTerminal: ReturnType<typeof vi.fn>
  sendTerminalAgentPrompt: ReturnType<typeof vi.fn>
}

function stubRuntime(overrides: Partial<OrcaRuntimeService> = {}): OrcaRuntimeService & SendSpies {
  return {
    getRuntimeId: () => 'test-runtime',
    resolveLiveLeafForHandle: () => null,
    getDriver: () => null,
    sendTerminal: vi.fn().mockResolvedValue({
      handle: HANDLE,
      accepted: true,
      bytesWritten: 1
    }),
    sendTerminalAgentPrompt: vi.fn().mockResolvedValue({
      handle: HANDLE,
      accepted: true,
      bytesWritten: 12
    }),
    ...overrides
  } as unknown as OrcaRuntimeService & SendSpies
}

function makeRequest(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'terminal.send', params }
}

async function send(runtime: OrcaRuntimeService, params: Record<string, unknown>) {
  const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
  return await dispatcher.dispatch(makeRequest({ terminal: HANDLE, ...params }))
}

describe('terminal.send agent-prompt route', () => {
  it('takes the agent-prompt path when the caller asks for it', async () => {
    const runtime = stubRuntime()

    const response = await send(runtime, {
      text: 'run the suite',
      enter: true,
      agentPrompt: true,
      client: { id: 'orca-cli', type: 'desktop' }
    })

    expect(response.ok).toBe(true)
    // Drop `agentPrompt` from the params schema and zod strips it, so this call
    // never happens and the raw path below runs instead.
    expect(runtime.sendTerminalAgentPrompt).toHaveBeenCalledWith(
      HANDLE,
      'run the suite',
      expect.anything()
    )
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })

  it('keeps the raw path when the caller does not ask', async () => {
    const runtime = stubRuntime()

    await send(runtime, {
      text: 'ls',
      enter: true,
      client: { id: 'orca-cli', type: 'desktop' }
    })

    expect(runtime.sendTerminal).toHaveBeenCalledOnce()
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('keeps the raw path without a submit, because there is nothing to submit', async () => {
    const runtime = stubRuntime()

    await send(runtime, {
      text: 'half a thought',
      agentPrompt: true,
      client: { id: 'orca-cli', type: 'desktop' }
    })

    expect(runtime.sendTerminal).toHaveBeenCalledOnce()
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('keeps the raw path for an interrupt, whose control byte paste framing would corrupt', async () => {
    const runtime = stubRuntime()

    await send(runtime, {
      text: 'stop',
      enter: true,
      interrupt: true,
      agentPrompt: true,
      client: { id: 'orca-cli', type: 'desktop' }
    })

    expect(runtime.sendTerminal).toHaveBeenCalledOnce()
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean agentPrompt instead of degrading to the raw path', async () => {
    const runtime = stubRuntime()

    // The whole defect was a malformed opt-in that failed open. `enter` and
    // `interrupt` are `z.unknown()` and coerce with `=== true`, so a string
    // there silently becomes false; this one must not.
    const response = await send(runtime, {
      text: 'run the suite',
      enter: true,
      agentPrompt: 'true',
      client: { id: 'orca-cli', type: 'desktop' }
    })

    expect(response.ok).toBe(false)
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('refuses rather than dropping a mobile input floor claim it cannot carry', async () => {
    const runtime = stubRuntime({
      resolveLiveLeafForHandle: () => ({ ptyId: 'pty-1' })
    } as unknown as Partial<OrcaRuntimeService>)

    const response = await send(runtime, {
      text: 'run the suite',
      enter: true,
      agentPrompt: true,
      client: { id: 'phone-1', type: 'mobile' }
    })

    expect(response.ok).toBe(false)
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })
})
