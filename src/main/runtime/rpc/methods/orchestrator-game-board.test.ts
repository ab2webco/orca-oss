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

  it('reads, sets and clears the STOP switch of the caller project', async () => {
    const { send, calls } = dispatcherWith({
      stopState: async () => ({ stopped: null }),
      setStop: async () => ({ stopped: { since: 'x', by: 'lead' }, changed: true }),
      clearStop: async () => ({ stopped: null, changed: true })
    })

    await send('game.stopSwitch', { terminalHandle: 'h1' })
    await send('game.stopSwitch', { terminalHandle: 'h1', set: true })
    await send('game.stopSwitch', { terminalHandle: 'h1', set: false })
    await expect(send('game.stopSwitch', { set: 'yes' })).resolves.toMatchObject({ ok: false })

    const caller = { worktreeId: undefined, terminalHandle: 'h1' }
    expect(calls).toEqual([
      ['stopState', caller],
      ['setStop', caller],
      ['clearStop', caller]
    ])
  })

  it("reads the caller's game inbox with its filters", async () => {
    const { send, calls } = dispatcherWith({
      inbox: async () => ({ inbox: { key: 'lead', unread: 0, messages: [], newest: 0 } })
    })

    await expect(
      send('game.inbox', { terminalHandle: 'h1', ticket: 'CIN-1', unread: true, markRead: true })
    ).resolves.toMatchObject({ ok: true, result: { inbox: { key: 'lead' } } })
    await expect(send('game.inbox', { markRead: 'yes' })).resolves.toMatchObject({ ok: false })
    expect(calls).toEqual([
      [
        'inbox',
        {
          worktreeId: undefined,
          terminalHandle: 'h1',
          ticket: 'CIN-1',
          unread: true,
          markRead: true
        }
      ]
    ])
  })

  it('asks, lists and answers owner questions, refusing a malformed call', async () => {
    const { send, calls } = dispatcherWith({
      askOwner: async () => ({ question: { id: 'oq_1' } }),
      ownerQuestions: async () => ({ questions: [], open: 0 }),
      answerOwner: async () => ({ delivered: true })
    })

    await expect(
      send('game.ownerAsk', {
        terminalHandle: 'h1',
        ticket: 'CIN-1',
        question: 'Ship it?',
        options: ['Yes', 'No'],
        context: 'PR #4'
      })
    ).resolves.toMatchObject({ ok: true, result: { question: { id: 'oq_1' } } })
    await expect(send('game.ownerQuestions', { all: true })).resolves.toMatchObject({ ok: true })
    await expect(send('game.ownerAnswer', { id: 'oq_1', option: 2 })).resolves.toMatchObject({
      ok: true,
      result: { delivered: true }
    })
    await expect(
      send('game.ownerAsk', { question: 'x', options: ['1', '2', '3', '4', '5', '6', '7'] })
    ).resolves.toMatchObject({ ok: false })
    await expect(send('game.ownerAnswer', { id: 'oq_1', option: 0 })).resolves.toMatchObject({
      ok: false
    })
    await expect(send('game.ownerAnswer', { id: 'oq_1' })).resolves.toMatchObject({ ok: false })
    expect(calls).toEqual([
      [
        'askOwner',
        {
          worktreeId: undefined,
          terminalHandle: 'h1',
          ticket: 'CIN-1',
          question: 'Ship it?',
          options: ['Yes', 'No'],
          context: 'PR #4'
        }
      ],
      ['ownerQuestions', { worktreeId: undefined, terminalHandle: undefined, all: true }],
      [
        'answerOwner',
        {
          worktreeId: undefined,
          terminalHandle: undefined,
          id: 'oq_1',
          option: 2,
          text: undefined
        }
      ]
    ])
  })
})

describe('game board RPC: Inbox threads (ORCA-878)', () => {
  it("reads the caller's project threads for the person's Inbox", async () => {
    const threads = { threads: [], waiting: [], answered: [] }
    const { send, calls } = dispatcherWith({ inboxThreads: async () => threads })

    await expect(send('game.inboxThreads', { worktreeId: 'wt_1' })).resolves.toMatchObject({
      ok: true,
      result: threads
    })
    expect(calls).toEqual([['inboxThreads', { worktreeId: 'wt_1', terminalHandle: undefined }]])
  })
})
