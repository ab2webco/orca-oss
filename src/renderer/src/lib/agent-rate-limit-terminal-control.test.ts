// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRuntimePtyInputVerified = vi.fn<(...args: unknown[]) => Promise<boolean>>()
const inspectRuntimeTerminalProcess =
  vi.fn<(...args: unknown[]) => Promise<{ foregroundProcess: string | null }>>()

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInputVerified: (...args: unknown[]) => sendRuntimePtyInputVerified(...args),
  inspectRuntimeTerminalProcess: (...args: unknown[]) => inspectRuntimeTerminalProcess(...args)
}))

import { stopForegroundAgent } from './agent-rate-limit-terminal-control'

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
})
