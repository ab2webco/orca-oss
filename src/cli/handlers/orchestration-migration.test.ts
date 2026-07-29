import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_HANDLERS } from './orchestration'

// Why both vars: a managed agent pane exports them and the send payload carries them, so an
// ambient value makes this exact-payload assertion pass or fail depending on who runs the suite.
const originalPaneKey = process.env.ORCA_PANE_KEY
const originalLaunchToken = process.env.ORCA_AGENT_LAUNCH_TOKEN

beforeEach(() => {
  delete process.env.ORCA_AGENT_LAUNCH_TOKEN
})

afterEach(() => {
  for (const [name, value] of [
    ['ORCA_PANE_KEY', originalPaneKey],
    ['ORCA_AGENT_LAUNCH_TOKEN', originalLaunchToken]
  ] as const) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
})

describe('orchestration CLI migration recovery', () => {
  it('forwards legacy worker_done without inventing a completion outcome', async () => {
    process.env.ORCA_PANE_KEY = 'tab-worker:leaf-worker'
    const call = vi.fn().mockResolvedValue({ result: { message: { id: 'msg_done' } } })

    await ORCHESTRATION_HANDLERS['orchestration send']({
      flags: new Map<string, string | boolean>([
        ['from', 'term_worker'],
        ['subject', 'Done'],
        ['type', 'worker_done']
      ]),
      client: { call },
      cwd: '/tmp/repo',
      json: true
    } as never)

    expect(call).toHaveBeenCalledWith('orchestration.send', {
      from: 'term_worker',
      to: undefined,
      run: undefined,
      subject: 'Done',
      body: undefined,
      type: 'worker_done',
      priority: undefined,
      threadId: undefined,
      payload: undefined,
      senderPaneKey: 'tab-worker:leaf-worker',
      senderLaunchToken: undefined,
      devMode: false
    })
  })
})
