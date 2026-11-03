import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { RpcResponse } from '../scripts/mock-server-rpc-handlers'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('mock server showcase owner answer', () => {
  it('has the lead relay the answer to the member who owns the ticket', async () => {
    vi.stubEnv('MOCK_SCENARIO', 'showcase')
    vi.useFakeTimers()
    const { handleRequest } = await import('../scripts/mock-server-rpc-handlers')
    const ws = { readyState: 1, OPEN: 1, once: () => {} } as unknown as WebSocket
    const sent: RpcResponse[] = []
    const call = (method: string, params: Record<string, unknown>) =>
      handleRequest({ id: `${method}-1`, method, params }, (response) => sent.push(response), ws)

    call('game.ownerQuestionsAll', {})
    const projects = (
      sent.at(-1)!.result as {
        projects: { questions: { id: string; ticket: string | null }[] }[]
      }
    ).projects
    const leoQuestion = projects
      .flatMap((project) => project.questions)
      .find((question) => question.ticket === 'ACME-214')!
    call('terminal.subscribe', { terminal: 'term-lead' })
    call('game.ownerAnswer', { id: leoQuestion.id, option: 1 })
    vi.advanceTimersByTime(5000)

    const output = sent
      .map((response) => (response.result as { chunk?: string } | undefined)?.chunk ?? '')
      .join('')
    expect(output).toContain('to Leo.')
    expect(output).not.toContain('to Iris.')
  })
})
