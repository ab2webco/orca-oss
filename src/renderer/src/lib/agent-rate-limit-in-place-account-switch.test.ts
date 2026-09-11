// The client's id for a remote pane is `remote:<env>@@<handle>`; the runtime
// indexes terminals by the bare handle. Sent as `ptyId`, the switch never
// resolved and came back "That terminal is not live on this runtime" for a
// terminal that was plainly alive — while `orca account switch --terminal
// <handle>` worked against the same session.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'

const callRuntimeRpc = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))

import { runInPlaceManagedClaudeAccountSwitch } from './agent-rate-limit-in-place-account-switch'

const TARGET = { id: 'acc-2', email: 'b@example.com' } as ClaudeManagedAccountSummary

function lastParams(): Record<string, unknown> {
  return callRuntimeRpc.mock.calls.at(-1)?.[3 - 1] as Record<string, unknown>
}

beforeEach(() => {
  callRuntimeRpc.mockReset()
  callRuntimeRpc.mockResolvedValue({ accepted: true, result: { state: 'committed' } })
})

describe('runInPlaceManagedClaudeAccountSwitch selector', () => {
  it('sends the runtime handle for a remote pane, never the client pty id', async () => {
    await runInPlaceManagedClaudeAccountSwitch({
      ptyId: 'remote:env-1@@term_abc',
      targetAccount: TARGET
    })

    const params = lastParams()
    expect(params.terminal).toBe('term_abc')
    // The whole defect in one line: the runtime cannot resolve this shape.
    expect(params.ptyId).toBeUndefined()
    expect(callRuntimeRpc.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'environment',
      environmentId: 'env-1'
    })
  })

  it('still sends the pty id for a local pane, which the runtime does index', async () => {
    await runInPlaceManagedClaudeAccountSwitch({ ptyId: 'local-pty-1', targetAccount: TARGET })

    const params = lastParams()
    expect(params.ptyId).toBe('local-pty-1')
    expect(params.terminal).toBeUndefined()
    expect(callRuntimeRpc.mock.calls.at(-1)?.[0]).toEqual({ kind: 'local' })
  })
})
