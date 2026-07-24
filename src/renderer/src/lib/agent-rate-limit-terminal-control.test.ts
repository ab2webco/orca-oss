// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRuntimePtyInputVerified = vi.fn<(...args: unknown[]) => Promise<boolean>>()
const inspectRuntimeTerminalProcess =
  vi.fn<(...args: unknown[]) => Promise<{ foregroundProcess: string | null; unavailable?: true }>>()

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInputVerified: (...args: unknown[]) => sendRuntimePtyInputVerified(...args),
  inspectRuntimeTerminalProcess: (...args: unknown[]) => inspectRuntimeTerminalProcess(...args)
}))

import { stopForegroundAgent, waitForResumedAgent } from './agent-rate-limit-terminal-control'

const CTRL_C = '\x03'
const baseArgs = {
  settings: null,
  ptyId: 'pty-1',
  agent: 'claude' as const,
  expectedProcess: 'claude'
}

beforeEach(() => {
  vi.useFakeTimers()
  sendRuntimePtyInputVerified.mockReset().mockResolvedValue(true)
  inspectRuntimeTerminalProcess.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('stopForegroundAgent', () => {
  it('returns immediately without sending Ctrl+C when the agent is not foreground', async () => {
    inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: 'zsh' })
    const result = await stopForegroundAgent(baseArgs)
    expect(result).toBe(true)
    expect(sendRuntimePtyInputVerified).not.toHaveBeenCalled()
  })

  it('sends a rapid Ctrl+C PAIR per attempt and stops once the agent exits', async () => {
    // foreground on the pre-check + first in-loop check, then cleared
    inspectRuntimeTerminalProcess
      .mockResolvedValueOnce({ foregroundProcess: 'claude' })
      .mockResolvedValue({ foregroundProcess: 'zsh' })

    const promise = stopForegroundAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(true)
    // exactly one attempt = two Ctrl+C, both to the same pty
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(2)
    expect(sendRuntimePtyInputVerified).toHaveBeenNthCalledWith(1, null, 'pty-1', CTRL_C)
    expect(sendRuntimePtyInputVerified).toHaveBeenNthCalledWith(2, null, 'pty-1', CTRL_C)
  })

  it('gives up after 3 attempts (6 Ctrl+C) when the agent never exits', async () => {
    inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: 'claude' })
    const promise = stopForegroundAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(false)
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(6)
  })

  it('aborts if the terminal rejects the Ctrl+C input', async () => {
    inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: 'claude' })
    sendRuntimePtyInputVerified.mockResolvedValue(false)
    const promise = stopForegroundAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(false)
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(1)
  })

  it('completes (best-effort Ctrl+C, no freeze) when a pre-update daemon cannot inspect', async () => {
    // Why: simulates the reported failover freeze — an old daemon rejects the
    // inspectProcess request with a DaemonProtocolError so the switch must degrade.
    inspectRuntimeTerminalProcess.mockRejectedValue(
      new Error(
        "Error invoking remote method 'pty:inspectProcess': DaemonProtocolError: Unknown request type: inspectProcess"
      )
    )
    const promise = stopForegroundAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(true)
    // one best-effort Ctrl+C pair was sent before proceeding with the switch
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(2)
  })

  it('completes when the version gate reports terminal_liveness_unavailable', async () => {
    inspectRuntimeTerminalProcess.mockRejectedValue(new Error('terminal_liveness_unavailable'))
    const promise = stopForegroundAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(true)
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(2)
  })

  it('completes when inspection resolves with the unavailable sentinel', async () => {
    inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: null, unavailable: true })
    const promise = stopForegroundAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(true)
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(2)
  })

  it('rethrows unrelated inspection errors instead of masking them', async () => {
    inspectRuntimeTerminalProcess.mockRejectedValue(new Error('some other failure'))
    await expect(stopForegroundAgent(baseArgs)).rejects.toThrow('some other failure')
  })
})

describe('waitForResumedAgent', () => {
  it('returns true as soon as the resumed agent takes foreground', async () => {
    inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: 'claude' })
    const promise = waitForResumedAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(true)
  })

  it('times out (false) when the resumed agent never appears on a healthy daemon', async () => {
    inspectRuntimeTerminalProcess.mockResolvedValue({ foregroundProcess: 'zsh' })
    const promise = waitForResumedAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(false)
  })

  it('assumes resume succeeded when a pre-update daemon cannot inspect', async () => {
    inspectRuntimeTerminalProcess.mockRejectedValue(
      new Error('DaemonProtocolError: Unknown request type: inspectProcess')
    )
    const promise = waitForResumedAgent(baseArgs)
    await vi.runAllTimersAsync()
    expect(await promise).toBe(true)
  })
})
