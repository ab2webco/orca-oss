import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../format', () => ({ printResult: vi.fn() }))

import { printResult } from '../format'
import { ORCHESTRATION_HANDLERS } from './orchestration'

beforeEach(() => {
  callMock.mockReset()
  vi.mocked(printResult).mockReset()
})

const longBody = `Blocked: ${'detail '.repeat(450)}`
const inboxWith = (...ids: string[]) => ({
  result: {
    messages: ids.map((id) => ({
      id,
      from_handle: 'dispatch:ctx_remote',
      to_handle: 'run:run_home',
      subject: 'Blocked',
      body: id === 'relay_long' ? longBody : 'Other.'
    })),
    count: ids.length
  }
})

const runInbox = (id: string) =>
  ORCHESTRATION_HANDLERS['orchestration inbox']({
    flags: new Map<string, string | boolean>([
      ['terminal', 'run:run_home'],
      ['id', id]
    ]),
    client: { call: callMock },
    cwd: '/repo',
    json: false
  } as never)

// Why (ORCA-858): check names this read for a body its watch line cut.
describe('orchestration inbox --id', () => {
  it('asks for the one message and prints its whole body', async () => {
    callMock.mockResolvedValue(inboxWith('relay_long'))

    await runInbox('relay_long')

    expect(callMock).toHaveBeenCalledWith('orchestration.inbox', {
      limit: undefined,
      terminal: 'run:run_home',
      id: 'relay_long'
    })
    const [response, , formatter] = vi.mocked(printResult).mock.calls[0]!
    expect(formatter((response as { result: unknown }).result)).toContain(longBody)
  })

  it('keeps only that message from a runtime that ignores the id', async () => {
    callMock.mockResolvedValue(inboxWith('msg_newer', 'relay_long', 'msg_older'))

    await runInbox('relay_long')

    const [response] = vi.mocked(printResult).mock.calls[0]!
    expect(
      (response as { result: { messages: { id: string }[] } }).result.messages.map((m) => m.id)
    ).toEqual(['relay_long'])
  })

  it('says so when no such message reached that recipient', async () => {
    callMock.mockResolvedValue(inboxWith('msg_other'))

    await expect(runInbox('relay_gone')).rejects.toThrow('No message relay_gone to run:run_home.')
    expect(printResult).not.toHaveBeenCalled()
  })
})
