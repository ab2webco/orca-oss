import { afterEach, expect, it, vi } from 'vitest'

const callMock = vi.fn()
vi.mock('../format', () => ({ printResult: vi.fn() }))
vi.mock('../selectors', () => ({ getTerminalHandle: vi.fn() }))

import { printResult } from '../format'
import { ORCHESTRATION_HANDLERS } from './orchestration'

afterEach(() => {
  vi.clearAllMocks()
  callMock.mockReset()
})

async function lineFor(delivery: { delivered?: boolean; deliveredAt?: string | null }) {
  callMock.mockResolvedValueOnce({
    result: {
      relay: {
        messageId: 'relay_1',
        sequence: 1,
        dispatchId: 'ctx_1',
        destination: 'worker',
        accepted: true,
        ...delivery
      }
    }
  })
  await ORCHESTRATION_HANDLERS['orchestration send']({
    flags: new Map([
      ['from', 'term_lead'],
      ['to', 'term_member'],
      ['subject', 'Stop opening PRs'],
      ['type', 'status']
    ]),
    client: { call: callMock },
    cwd: '/tmp/repo',
    json: false
  } as never)
  const [response, , format] = vi.mocked(printResult).mock.calls.at(-1)!
  return (format as (result: unknown) => string)((response as { result: unknown }).result)
}

// Why: three stop orders to a member on m1 printed a plain 'Queued' while he never saw them (ORCA-1301).
it('says a send its host has not taken is NOT delivered', async () => {
  await expect(lineFor({ delivered: false, deliveredAt: null })).resolves.toContain('NOT delivered')
})

it('says when the host took a delivered send', async () => {
  await expect(lineFor({ delivered: true, deliveredAt: '2026-11-20 05:00:00' })).resolves.toBe(
    "Delivered relay_1 to worker Dispatch ctx_1's host at 2026-11-20 05:00:00"
  )
})

it('keeps the plain line for an older home that reports no delivery', async () => {
  await expect(lineFor({})).resolves.toBe('Queued relay_1 for worker Dispatch ctx_1')
})

async function replyLineFor(result: Record<string, unknown>) {
  callMock.mockResolvedValueOnce({ result: { message: { id: 'msg_reply' }, ...result } })
  await ORCHESTRATION_HANDLERS['orchestration reply']({
    flags: new Map([
      ['from', 'term_lead'],
      ['id', 'relay_escalation'],
      ['body', 'Use 8080']
    ]),
    client: { call: callMock },
    cwd: '/tmp/repo',
    json: false
  } as never)
  const [response, , format] = vi.mocked(printResult).mock.calls.at(-1)!
  return (format as (result: unknown) => string)((response as { result: unknown }).result)
}

// Why (ORCA-1267): a reply to a remote member printed "Replied" whether or not it reached it.
it('says a reply its remote member has not taken is NOT delivered', async () => {
  const relay = { messageId: 'relay_1', sequence: 1, dispatchId: 'ctx_1', destination: 'worker' }
  await expect(
    replyLineFor({ relay: { ...relay, accepted: true, delivered: false, deliveredAt: null } })
  ).resolves.toContain('NOT delivered')
})

it('says a reply to a settled remote member was kept at home only', async () => {
  await expect(replyLineFor({ homeOnly: { dispatchId: 'ctx_1' } })).resolves.toContain(
    'at home only'
  )
})
