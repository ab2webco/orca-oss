import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_METHODS } from './orchestrator-game'
import { ORCHESTRATOR_GAME_VIEWS } from '../../../../shared/orchestrator-game-view'

function request(params?: unknown): RpcRequest {
  return { id: 'game-state-test', authToken: 'test', method: 'game.state', params }
}

describe('game.state RPC', () => {
  it('passes the caller terminal context to the runtime', async () => {
    const calls: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      getOrchestratorGameState: async (args: unknown) => {
        calls.push(args)
        return { config: { mode: 'on' } }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(
      dispatcher.dispatch(request({ worktreeId: 'wt1', terminalHandle: 'h1', paneKey: 'tab:leaf' }))
    ).resolves.toMatchObject({ ok: true, result: { config: { mode: 'on' } } })
    expect(calls).toEqual([{ worktreeId: 'wt1', terminalHandle: 'h1', paneKey: 'tab:leaf' }])
  })

  it("passes a member pane's Jev report on as it came, never refusing the state over it", async () => {
    const calls: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      getOrchestratorGameState: async (args: unknown) => {
        calls.push(args)
        return { config: { mode: 'on' } }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const advisor = { version: 9, model: ['a newer shape'] }

    await expect(
      dispatcher.dispatch(request({ paneKey: 'tab:member', advisor }))
    ).resolves.toMatchObject({ ok: true })
    await expect(
      dispatcher.dispatch(request({ paneKey: 'tab:member', advisor: null }))
    ).resolves.toMatchObject({ ok: true })
    expect(calls).toEqual([
      { paneKey: 'tab:member', advisor },
      { paneKey: 'tab:member', advisor: null }
    ])
  })

  it('rejects a non-string worktree id', async () => {
    const runtime = { getRuntimeId: () => 'runtime' } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(dispatcher.dispatch(request({ worktreeId: 4 }))).resolves.toMatchObject({
      ok: false
    })
  })

  it('opens a game link in the system browser through the runtime, http(s) only', async () => {
    const opened: string[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      openGameLinkInSystemBrowser: async (url: string) => {
        opened.push(url)
        return { opened: true }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const open = (url: unknown) =>
      dispatcher.dispatch({ id: 'o', authToken: 'test', method: 'game.openLink', params: { url } })

    await expect(open('https://github.com/o/r/pulls')).resolves.toMatchObject({
      ok: true,
      result: { opened: true }
    })
    await expect(open('file:///etc/passwd')).resolves.toMatchObject({ ok: false })
    await expect(open('javascript:alert(1)')).resolves.toMatchObject({ ok: false })
    expect(opened).toEqual(['https://github.com/o/r/pulls'])
  })

  it('records a freed member for the caller project, refusing a malformed record', async () => {
    const recorded: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      recordGameHistory: async (args: unknown) => {
        recorded.push(args)
        return { recorded: true }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const record = {
      ticket: 'CIN-1',
      repo: null,
      branch: 'cin-1',
      agent: 'claude',
      account: null,
      launchedAt: null,
      endedAt: '2026-10-16T10:00:00.000Z',
      outcome: 'merged',
      pr: '#41 merged',
      lastReport: null
    }
    const send = (params: unknown) =>
      dispatcher.dispatch({ id: 'h', authToken: 'test', method: 'game.historyRecord', params })

    await expect(
      send({ worktreeId: 'wt1', memberWorktreeId: 'wt-cin-1', record })
    ).resolves.toMatchObject({ ok: true, result: { recorded: true } })
    await expect(
      send({ worktreeId: 'wt1', record: { ...record, outcome: 'won' } })
    ).resolves.toMatchObject({
      ok: false
    })
    expect(recorded).toEqual([
      { worktreeId: 'wt1', terminalHandle: undefined, memberWorktreeId: 'wt-cin-1', record }
    ])
  })

  it("lists the caller project's history with its filters", async () => {
    const asked: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      listGameHistory: async (args: unknown) => {
        asked.push(args)
        return { records: [] }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(
      dispatcher.dispatch({
        id: 'l',
        authToken: 'test',
        method: 'game.history',
        params: { terminalHandle: 'h1', ticket: 'CIN-1', since: '2026-10-01' }
      })
    ).resolves.toMatchObject({ ok: true, result: { records: [] } })
    expect(asked).toEqual([
      { worktreeId: undefined, terminalHandle: 'h1', ticket: 'CIN-1', since: '2026-10-01' }
    ])
  })

  it("passes the freed member's character on for its lesson", async () => {
    const recorded: { character?: unknown }[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      recordGameHistory: async (args: { character?: unknown }) => {
        recorded.push(args)
        return { recorded: true }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const record = {
      ticket: 'CIN-1',
      repo: null,
      branch: null,
      agent: 'claude',
      account: null,
      launchedAt: null,
      endedAt: '2026-10-16T10:00:00.000Z',
      outcome: 'failed',
      pr: null,
      lastReport: null
    }
    await dispatcher.dispatch({
      id: 'c',
      authToken: 'test',
      method: 'game.historyRecord',
      params: { worktreeId: 'wt1', record, character: 'Arturo', characterKey: 'arthur' }
    })
    expect(recorded[0]).toMatchObject({ character: 'Arturo', characterKey: 'arthur' })
  })

  it("lists the caller project's lessons", async () => {
    const asked: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      listGameLessons: async (args: unknown) => {
        asked.push(args)
        return { lessons: [] }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(
      dispatcher.dispatch({
        id: 'ls',
        authToken: 'test',
        method: 'game.lessons',
        params: { worktreeId: 'wt1' }
      })
    ).resolves.toMatchObject({ ok: true, result: { lessons: [] } })
    expect(asked).toEqual([{ worktreeId: 'wt1', terminalHandle: undefined }])
  })

  it("lists the caller project's characters", async () => {
    const asked: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      listGameCharacters: async (args: unknown) => {
        asked.push(args)
        return { characters: [] }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    await expect(
      dispatcher.dispatch({
        id: 'ch',
        authToken: 'test',
        method: 'game.characters',
        params: { terminalHandle: 'h1' }
      })
    ).resolves.toMatchObject({ ok: true, result: { characters: [] } })
    expect(asked).toEqual([{ worktreeId: undefined, terminalHandle: 'h1' }])
  })
})

describe('game.memberRecord RPC', () => {
  it("passes a lead's member on and refuses a malformed ticket", async () => {
    const recorded: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      recordGameMember: async (args: unknown) => {
        recorded.push(args)
        return { recorded: true }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const send = (params: unknown) =>
      dispatcher.dispatch({ id: 'm', authToken: 'test', method: 'game.memberRecord', params })
    const member = { ticket: 'CIN-1', taskId: 'task_1', runId: 'run_1', newerField: 'x' }

    await expect(send({ terminalHandle: 'h1', member })).resolves.toMatchObject({
      ok: true,
      result: { recorded: true }
    })
    await expect(
      send({ terminalHandle: 'h1', member: { ticket: 'CIN 1; rm', taskId: 'task_1' } })
    ).resolves.toMatchObject({ ok: false })
    expect(recorded).toEqual([
      {
        worktreeId: undefined,
        terminalHandle: 'h1',
        member: { ticket: 'CIN-1', taskId: 'task_1', runId: 'run_1' }
      }
    ])
  })
})

describe('game.memberResume and game.memberDiscard RPCs', () => {
  it('pass one ticket to resume, and named tickets or all to discard', async () => {
    const asked: [string, unknown][] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      resumeGameMember: async (args: unknown) => {
        asked.push(['resume', args])
        return { outcome: 'finished', ticket: 'CIN-1' }
      },
      discardGameMembers: async (args: unknown) => {
        asked.push(['discard', args])
        return { discarded: [], setAside: null }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const send = (method: string, params: unknown) =>
      dispatcher.dispatch({ id: 'r', authToken: 'test', method, params })

    await expect(
      send('game.memberResume', { terminalHandle: 'h1', ticket: 'CIN-1' })
    ).resolves.toMatchObject({ ok: true, result: { outcome: 'finished' } })
    await expect(
      send('game.memberDiscard', { terminalHandle: 'h1', tickets: 'all' })
    ).resolves.toMatchObject({ ok: true })
    await expect(
      send('game.memberDiscard', { terminalHandle: 'h1', tickets: ['CIN-2'] })
    ).resolves.toMatchObject({ ok: true })
    await expect(
      send('game.memberDiscard', { terminalHandle: 'h1', tickets: [] })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      send('game.memberResume', { terminalHandle: 'h1', ticket: '../x' })
    ).resolves.toMatchObject({ ok: false })
    expect(asked).toEqual([
      ['resume', { worktreeId: undefined, terminalHandle: 'h1', ticket: 'CIN-1' }],
      ['discard', { worktreeId: undefined, terminalHandle: 'h1', tickets: 'all' }],
      ['discard', { worktreeId: undefined, terminalHandle: 'h1', tickets: ['CIN-2'] }]
    ])
  })
})

describe('game.memberNameReserve RPC', () => {
  it('hands the roster and the taken names to the runtime, and refuses a bad ticket', async () => {
    const asked: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      reserveGameMemberName: async (args: unknown) => {
        asked.push(args)
        return { name: 'Merlin' }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const send = (params: unknown) =>
      dispatcher.dispatch({ id: 'r', authToken: 'test', method: 'game.memberNameReserve', params })
    const params = {
      worktreeId: 'wt1',
      terminalHandle: 'h1',
      ticket: 'CIN-12',
      roster: [{ en: 'Arthur', es: 'Arturo' }, 'Merlin'],
      locale: 'es',
      taken: ['Arthur']
    }

    await expect(send(params)).resolves.toMatchObject({ ok: true, result: { name: 'Merlin' } })
    await expect(send({ ...params, ticket: '../x' })).resolves.toMatchObject({ ok: false })
    expect(asked).toEqual([params])
  })
})

describe('game.setView RPC', () => {
  it('stores a known view for a known scope and refuses anything else', async () => {
    const calls: unknown[] = []
    const runtime = {
      getRuntimeId: () => 'runtime',
      setOrchestratorGameView: async (args: unknown) => {
        calls.push(args)
        return { view: 'flat', scope: 'global', layer: 'global' }
      }
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })
    const set = (params: unknown) =>
      dispatcher.dispatch({ id: 'v', authToken: 'test', method: 'game.setView', params })

    await expect(set({ view: 'flat', scope: 'global', worktreeId: 'w1' })).resolves.toMatchObject({
      ok: true,
      result: { view: 'flat', layer: 'global' }
    })
    await expect(set({ view: '3d-band', scope: 'global' })).resolves.toMatchObject({ ok: false })
    await expect(set({ view: 'flat', scope: 'pane' })).resolves.toMatchObject({ ok: false })
    expect(calls).toEqual([
      { view: 'flat', scope: 'global', worktreeId: 'w1', terminalHandle: undefined }
    ])
  })

  it('accepts every view the table lists', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime',
      setOrchestratorGameView: async (args: { view: string }) => args
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_METHODS })

    for (const { id } of ORCHESTRATOR_GAME_VIEWS) {
      await expect(
        dispatcher.dispatch({
          id: id,
          authToken: 'test',
          method: 'game.setView',
          params: { view: id, scope: 'project' }
        })
      ).resolves.toMatchObject({ ok: true, result: { view: id } })
    }
  })
})

describe('game.fleetWait RPC', () => {
  const dispatcherWith = (waitGameFleetChange: (args: unknown) => Promise<unknown>) =>
    new RpcDispatcher({
      runtime: {
        getRuntimeId: () => 'runtime',
        waitGameFleetChange
      } as unknown as OrcaRuntimeService,
      methods: ORCHESTRATOR_GAME_METHODS
    })
  const wait = (dispatcher: RpcDispatcher, params?: unknown) =>
    dispatcher.dispatch({ id: 'w', authToken: 'test', method: 'game.fleetWait', params })

  it('long-polls the runtime from the version the caller saw, 25 s by default', async () => {
    const calls: unknown[] = []
    const dispatcher = dispatcherWith(async (args) => {
      calls.push(args)
      return { version: 4, changed: true }
    })

    await expect(wait(dispatcher, { since: 3 })).resolves.toMatchObject({
      ok: true,
      result: { version: 4, changed: true }
    })
    await wait(dispatcher)
    expect(calls).toEqual([
      { since: 3, timeoutMs: 25_000 },
      { since: undefined, timeoutMs: 25_000 }
    ])
  })

  it('refuses a wait longer than a minute', async () => {
    const dispatcher = dispatcherWith(async () => ({ version: 0, changed: false }))

    await expect(wait(dispatcher, { since: 0, timeoutMs: 600_000 })).resolves.toMatchObject({
      ok: false
    })
  })
})
