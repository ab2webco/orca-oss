import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_BOARD_METHODS } from './orchestrator-game-board'

function dispatcherWith(board: Record<string, (args: unknown) => Promise<unknown>>) {
  const calls: [string, unknown][] = []
  const gameBoard = Object.fromEntries(
    Object.entries(board).map(([name, fn]) => [
      name,
      async (args: unknown) => {
        calls.push([name, args])
        return fn(args)
      }
    ])
  )
  const runtime = {
    getRuntimeId: () => 'runtime',
    getGameBoard: () => gameBoard
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_BOARD_METHODS })
  const send = (method: string, params: unknown) =>
    dispatcher.dispatch({ id: 'b', authToken: 'test', method, params })
  return { send, calls }
}

describe('game board RPC', () => {
  it("posts an event of a known kind for the caller's project", async () => {
    const { send, calls } = dispatcherWith({ postEvent: async () => ({ posted: true }) })

    await expect(
      send('game.eventPost', {
        terminalHandle: 'h1',
        kind: 'pr_opened',
        ticket: 'CIN-1',
        text: 'PR #41'
      })
    ).resolves.toMatchObject({ ok: true, result: { posted: true } })
    await expect(send('game.eventPost', { kind: 'exploded' })).resolves.toMatchObject({
      ok: false
    })
    await expect(
      send('game.eventPost', { kind: 'failed', text: 'x'.repeat(700) })
    ).resolves.toMatchObject({ ok: false })
    expect(calls).toEqual([
      [
        'postEvent',
        {
          worktreeId: undefined,
          terminalHandle: 'h1',
          kind: 'pr_opened',
          ticket: 'CIN-1',
          text: 'PR #41',
          key: undefined
        }
      ]
    ])
  })

  it("lists the caller project's events with its filters", async () => {
    const { send, calls } = dispatcherWith({ events: async () => ({ events: [] }) })

    await expect(
      send('game.events', { worktreeId: 'wt1', ticket: 'CIN-1', since: '2026-10-01' })
    ).resolves.toMatchObject({ ok: true, result: { events: [] } })
    expect(calls).toEqual([
      [
        'events',
        { worktreeId: 'wt1', terminalHandle: undefined, ticket: 'CIN-1', since: '2026-10-01' }
      ]
    ])
  })
})
