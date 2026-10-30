import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()
const originalTerminalHandle = process.env.ORCA_TERMINAL_HANDLE
const originalPaneKey = process.env.ORCA_PANE_KEY

vi.mock('../selectors', () => ({ getTerminalHandle: vi.fn() }))

import { ORCHESTRATION_HANDLERS } from './orchestration'

// Why (ORCA-833): a lead reading `check --wait --watch --json 2>&1` line by line saw only the
// one-line keepalives; the pretty-printed result never parsed as a line, so a worker_done was missed.
describe('orchestration check --wait --json output is NDJSON', () => {
  let stdout: string[]

  beforeEach(() => {
    callMock.mockReset()
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    delete process.env.ORCA_PANE_KEY
    stdout = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(`${args.map(String).join(' ')}\n`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const [name, value] of [
      ['ORCA_TERMINAL_HANDLE', originalTerminalHandle],
      ['ORCA_PANE_KEY', originalPaneKey]
    ] as const) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })

  const invokeCheck = (flags: [string, string | boolean][], json = true) =>
    ORCHESTRATION_HANDLERS['orchestration check']({
      flags: new Map(flags),
      client: { call: callMock },
      cwd: '/tmp/repo',
      json
    } as never)

  const delivery = {
    id: 'req_1',
    ok: true,
    result: {
      deliveryId: 'dlv_2',
      messages: [
        {
          id: 'msg_1',
          from_handle: 'term_member',
          type: 'worker_done',
          subject: 'done',
          body: 'line one\nline two',
          read: 0
        }
      ],
      count: 1,
      timedOut: false,
      acknowledged: null
    }
  }

  it('prints the --watch result as one compact JSON line', async () => {
    callMock
      .mockResolvedValueOnce({
        id: 'req_0',
        ok: true,
        result: { deliveryId: null, messages: [], count: 0, timedOut: true, acknowledged: null }
      })
      .mockResolvedValueOnce(delivery)
    await invokeCheck([
      ['wait', true],
      ['watch', true]
    ])
    const output = stdout.join('')
    const lines = output.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.result).toMatchObject({ deliveryId: 'dlv_2', count: 1 })
    expect(parsed.result.messages[0].body).toBe('line one\nline two')
  })

  it('prints a --wait result without --watch as one line too, since keepalives share the stream', async () => {
    callMock.mockResolvedValueOnce(delivery)
    await invokeCheck([['wait', true]])
    const lines = stdout
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).result.deliveryId).toBe('dlv_2')
  })

  it('keeps a plain --json check pretty-printed', async () => {
    callMock.mockResolvedValueOnce(delivery)
    await invokeCheck([])
    const output = stdout.join('')
    expect(output.split('\n').filter((line) => line.length > 0).length).toBeGreaterThan(1)
    expect(JSON.parse(output).result.deliveryId).toBe('dlv_2')
  })
})
