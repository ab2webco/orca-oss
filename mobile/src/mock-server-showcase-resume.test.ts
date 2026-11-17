import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { RpcResponse } from '../scripts/mock-server-rpc-handlers'
import { teamLeadViewOf } from './team-drawer/team-drawer-model'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('mock server showcase member resume', () => {
  it('stops the member a question names and resumes it once the owner answers', async () => {
    vi.stubEnv('MOCK_SCENARIO', 'showcase')
    vi.useFakeTimers()
    const { handleRequest } = await import('../scripts/mock-server-rpc-handlers')
    const { addShowcaseOwnerQuestion } = await import('../scripts/mock-server-showcase-team')
    const { LEAD_WORKTREE_ID } = await import('../scripts/mock-server-showcase-scenario')
    const ws = { readyState: 1, OPEN: 1, once: () => {} } as unknown as WebSocket
    const sent: RpcResponse[] = []
    const call = (method: string, params: Record<string, unknown>): unknown => {
      handleRequest({ id: `${method}-1`, method, params }, (response) => sent.push(response), ws)
      return sent.at(-1)!.result
    }
    // Through the phone's own reader, with the open questions' tickets as the Team sheet passes them.
    const nova = () => {
      const { projects } = call('game.ownerQuestionsAll', {}) as {
        projects: { worktreeId: string; questions: { ticket: string | null }[] }[]
      }
      const tickets = new Set(
        projects
          .filter((one) => one.worktreeId === LEAD_WORKTREE_ID)
          .flatMap((one) => one.questions.flatMap((question) => question.ticket ?? []))
      )
      const state = call('game.state', { worktreeId: LEAD_WORKTREE_ID })
      return teamLeadViewOf(state, tickets)!.members.find((one) => one.name === 'Nova')!
    }

    expect(nova()).toMatchObject({ state: 'working', needsYou: false, host: 'ci-runner' })

    const added = addShowcaseOwnerQuestion()!
    expect(added.question).toMatchObject({ ticket: 'LUM-25', options: ['Yes', 'Wi-Fi only'] })
    expect(nova()).toMatchObject({ state: 'idle', needsYou: true, live: null })

    call('terminal.subscribe', { terminal: 'term-lead' })
    call('game.ownerAnswer', { id: added.question.id, option: 2 })
    vi.advanceTimersByTime(5000)

    expect(nova()).toMatchObject({
      state: 'working',
      needsYou: false,
      live: 'Edit · UploadQueue.ts',
      model: 'Opus 5.5 · high'
    })
    const output = sent
      .map((response) => (response.result as { chunk?: string } | undefined)?.chunk ?? '')
      .join('')
    expect(output).toContain('"Wi-Fi only" to Nova.')
  })
})
