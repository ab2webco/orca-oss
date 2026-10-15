import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { parseArgs } from '../args'
import { RuntimeClientError, RuntimeRpcFailureError } from '../runtime/types'
import { EVENTS_HANDLERS } from './events'

type Frame = Record<string, unknown>

function fakeClient(frames: Frame[], options: { isRemote?: boolean; failure?: Error } = {}) {
  const stream = vi.fn(async (_method: string, _params: unknown, onFrame: (f: unknown) => void) => {
    if (options.failure) {
      throw options.failure
    }
    frames.forEach(onFrame)
  })
  const client = { stream, isRemote: options.isRemote ?? false } as unknown as RuntimeClient
  return { client, stream }
}

const agentEvent = {
  name: 'agent.status.changed',
  at: Date.UTC(2026, 9, 14, 13, 5, 9),
  worktreeId: 'wt-1',
  terminal: 'term_a',
  payload: { paneKey: 'tab:leaf', state: 'done', agentType: 'claude' }
}

async function run(argv: string[], client: RuntimeClient, json: boolean): Promise<string[]> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    lines.push(line)
  })
  const { flags } = parseArgs(argv)
  await EVENTS_HANDLERS.events({ flags, client, cwd: '/tmp/wt', json })
  return lines
}

describe('orca events', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('subscribes with every --event value and prints one JSON line per frame', async () => {
    const { client, stream } = fakeClient([
      { type: 'ready', subscriptionId: 'events:local:1' },
      { type: 'event', event: agentEvent },
      { type: 'dropped', count: 3 },
      { type: 'end' }
    ])
    const lines = await run(
      [
        'events',
        '--event',
        'agent.*,terminal.closed',
        '--event',
        'worktree.created',
        '--terminal',
        'term_a'
      ],
      client,
      true
    )
    expect(stream).toHaveBeenCalledWith(
      'events.subscribe',
      { names: ['agent.*', 'terminal.closed', 'worktree.created'], terminal: 'term_a' },
      expect.any(Function)
    )
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { ready: true },
      agentEvent,
      { dropped: 3 }
    ])
  })

  it('prints a readable line per event without --json', async () => {
    const { client } = fakeClient([{ type: 'event', event: agentEvent }])
    const [line] = await run(['events'], client, false)
    expect(line).toContain('agent.status.changed')
    expect(line).toContain('term_a')
    expect(line).toContain('done')
  })

  it('rejects an unknown event name before connecting, naming the valid ones', async () => {
    const { client, stream } = fakeClient([])
    await expect(run(['events', '--event', 'agent.done'], client, true)).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('agent.status.changed')
    })
    expect(stream).not.toHaveBeenCalled()
  })

  it('says plainly that a paired remote host is not supported yet', async () => {
    const { client, stream } = fakeClient([], { isRemote: true })
    await expect(run(['events'], client, true)).rejects.toBeInstanceOf(RuntimeClientError)
    expect(stream).not.toHaveBeenCalled()
  })

  it('tells the user to update when the running app predates events', async () => {
    const failure = new RuntimeRpcFailureError({
      id: 'r1',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: events.subscribe' },
      _meta: { runtimeId: 'rt' }
    })
    const { client } = fakeClient([], { failure })
    await expect(run(['events'], client, true)).rejects.toMatchObject({
      message: expect.stringContaining('Update Orca Lab')
    })
  })
})
