import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
import type { PlaneBoardScope } from './plane-board-scope'
import {
  usePlaneBoard,
  type PlaneBoard,
  type PlaneBoardRows,
  type PlaneBoardStatus
} from './use-plane-board'

const CAPABILITIES = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]

const PROJECTS = [
  { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
  { id: 'p2', identifier: 'LAB', name: 'Lab Two' }
]

const STATES = [
  { id: 's-todo', name: 'Todo', group: 'unstarted', sequence: 1 },
  { id: 's-done', name: 'Done', group: 'completed', sequence: 2 }
]

function card(projectIndex: number): PlaneMobileWorkItem {
  const project = PROJECTS[projectIndex]!
  return {
    id: `wi-${project.id}`,
    identifier: `${project.identifier}-1`,
    title: `Card of ${project.name}`,
    url: `https://plane.example/wi-${project.id}`,
    project,
    state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
    priority: 'none',
    assignees: [],
    updatedAt: '2026-09-04T00:00:00.000Z'
  } as unknown as PlaneMobileWorkItem
}

// The board reads a scope the Tasks screen owns, and the rows it draws are the ones that
// screen already read; a change of project or connection is a scope prop change.
function scopeFor(
  projectId: string | null,
  overrides: Partial<PlaneBoardScope> = {}
): PlaneBoardScope {
  const project = PROJECTS.find((entry) => entry.id === projectId) ?? null
  return {
    enabled: true,
    planeConnected: true,
    workspaceId: 'ws-1',
    projectId,
    projectName: project ? project.name : null,
    filter: 'all',
    query: '',
    ...overrides
  }
}

type MountOptions = {
  scope?: PlaneBoardScope
  /** What the Tasks screen already has on screen. */
  items?: readonly PlaneMobileWorkItem[]
  /** Its read is still in flight. */
  loading?: boolean
  /** The state metadata read never answers. */
  hangStates?: boolean
  failStates?: Error
  capabilities?: readonly string[] | undefined
}

function mountBoard(options: MountOptions = {}) {
  const statuses: PlaneBoardStatus[] = []
  const cardIds: string[][] = []
  const calls: { method: string; params: unknown }[] = []
  let latest: PlaneBoard | null = null
  let refreshes = 0
  const reply = (result: unknown) => ({ id: '1', ok: true, result })
  const client = {
    sendRequest: (method: string, params?: unknown) => {
      calls.push({ method, params })
      switch (method) {
        case 'plane.listStates':
          if (options.hangStates) {
            return new Promise(() => {})
          }
          if (options.failStates) {
            return Promise.reject(options.failStates)
          }
          return Promise.resolve(reply(STATES))
        case 'plane.updateWorkItem':
          return Promise.resolve(reply({ ok: true }))
        case 'plane.createWorkItem':
          return Promise.resolve(reply({ ok: true, id: 'wi-new', identifier: 'ORCA-9', url: '' }))
        default:
          return new Promise(() => {})
      }
    }
  } as unknown as RpcClient

  type ProbeProps = {
    scope: PlaneBoardScope
    rows: PlaneBoardRows
    capabilities: readonly string[] | undefined
  }

  function Probe({ scope, rows, capabilities }: ProbeProps) {
    const board = usePlaneBoard(client, capabilities, scope, rows)
    latest = board
    statuses.push(board.status)
    cardIds.push(board.columns.flatMap((column) => column.items).map((item) => item.id))
    return null
  }

  const refresh = async (): Promise<PlaneMobileWorkItem[] | null> => {
    refreshes += 1
    return [...props.rows.items]
  }
  let renderer!: ReactTestRenderer
  const props: ProbeProps = {
    scope: options.scope ?? scopeFor('p1'),
    rows: {
      items: options.items ?? [card(0)],
      loading: options.loading ?? false,
      refreshing: false,
      refresh
    },
    capabilities: 'capabilities' in options ? options.capabilities : CAPABILITIES
  }
  act(() => {
    renderer = create(createElement(Probe, props))
  })

  const update = (): void => {
    act(() => {
      renderer.update(createElement(Probe, { ...props }))
    })
  }

  return {
    statuses,
    calls,
    get refreshes(): number {
      return refreshes
    },
    get board(): PlaneBoard {
      if (!latest) {
        throw new Error('probe never rendered')
      }
      return latest
    },
    /** The cards drawn on the render at that index; [0] is the mount render. */
    cardsAt(index: number): string[] {
      return cardIds[index] ?? []
    },
    cards(): string[] {
      return this.board.columns.flatMap((column) => column.items).map((item) => item.id)
    },
    /** Counts entries where status became 'loading', i.e. spinner repaints. */
    loadingTransitions(): number {
      return statuses.filter((entry, index) => entry === 'loading' && statuses[index - 1] !== entry)
        .length
    },
    setScope(scope: PlaneBoardScope): void {
      props.scope = scope
      update()
    },
    setRows(rows: Partial<Omit<PlaneBoardRows, 'refresh'>>): void {
      props.rows = { ...props.rows, ...rows }
      update()
    },
    async settle(): Promise<void> {
      for (let hop = 0; hop < 8; hop += 1) {
        await act(async () => {
          await Promise.resolve()
        })
      }
    }
  }
}

describe('usePlaneBoard: the board is a reprojection of the list', () => {
  it('draws the rows it was given without reading work items again', async () => {
    const mounted = mountBoard()
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.cards()).toEqual(['wi-p1'])
    // ORCA-417: the board used to run its own plane.listWorkItems for the same project.
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(0)
  })

  it('shows the cards on the very first render when the list already has them', () => {
    // ORCA-417: switching from list to board must paint columns with cards in the first
    // frame. Read before settle: this is the mount render.
    const mounted = mountBoard()

    expect(mounted.statuses[0]).toBe('ready')
    expect(mounted.cardsAt(0)).toEqual(['wi-p1'])
    expect(mounted.loadingTransitions()).toBe(0)
  })

  it('starts the very first render on the spinner when nothing is loaded yet', async () => {
    // ORCA-387, still true for a board with nothing to draw: it must open on 'loading',
    // not settle 'idle' for a frame and paint an empty board first.
    const mounted = mountBoard({ items: [], loading: true })
    expect(mounted.statuses[0]).toBe('loading')

    mounted.setRows({ items: [card(0)], loading: false })
    await mounted.settle()
    expect(mounted.board.status).toBe('ready')
    expect(mounted.loadingTransitions()).toBe(1)
  })

  it('settles a project that really has no cards on its empty state, never on the spinner', async () => {
    const mounted = mountBoard({ items: [], loading: false })
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.board.emptyState?.kind).toBe('board-empty')
    expect(mounted.loadingTransitions()).toBe(0)
  })

  it('stays idle from the first render when it mounts with no project to read', async () => {
    const mounted = mountBoard({ scope: scopeFor(null) })
    // The negative branch of the same guard: nothing to read, so no spinner at all.
    expect(mounted.statuses[0]).toBe('idle')

    await mounted.settle()

    expect(mounted.board.status).toBe('idle')
    expect(mounted.board.error).toBeNull()
    expect(mounted.board.emptyState?.kind).toBe('no-project')
    expect(mounted.loadingTransitions()).toBe(0)
    expect(mounted.calls).toHaveLength(0)
  })

  it('settles disconnected on an empty state without reading, from the first render', async () => {
    // The hook does not probe the host itself; the caller passes planeConnected, so a host
    // that reports no Plane arrives here as planeConnected=false. It must settle showing the
    // cause, not spin and not read.
    const mounted = mountBoard({ scope: scopeFor('p1', { planeConnected: false }) })
    expect(mounted.statuses[0]).toBe('idle')

    await mounted.settle()

    expect(mounted.board.status).toBe('idle')
    expect(mounted.board.error).toBeNull()
    expect(mounted.board.emptyState?.kind).toBe('disconnected')
    expect(mounted.cards()).toEqual([])
    expect(mounted.calls).toHaveLength(0)
  })

  it('masks a settled board behind the disconnected empty state when it loses connection', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    expect(mounted.board.status).toBe('ready')
    expect(mounted.board.columns.length).toBeGreaterThan(0)

    mounted.setScope(scopeFor('p1', { planeConnected: false }))
    await mounted.settle()

    // ready → idle: the disconnected cause takes over so the stale columns never show through.
    expect(mounted.board.status).toBe('idle')
    expect(mounted.board.error).toBeNull()
    expect(mounted.board.emptyState?.kind).toBe('disconnected')
  })

  it('never renders one project’s rows under another', async () => {
    // The list may hold every project's rows under "All projects"; a scoped board shows
    // only its own, so p1's card must not appear while the scope says p2.
    const mounted = mountBoard({ items: [card(0)] })
    await mounted.settle()
    expect(mounted.cards()).toEqual(['wi-p1'])

    mounted.setScope(scopeFor('p2'))
    await mounted.settle()

    expect(mounted.cards()).toEqual([])
  })

  it('swaps to the other project’s rows without a spinner once the list has them', async () => {
    const mounted = mountBoard()
    await mounted.settle()

    mounted.setScope(scopeFor('p2'))
    mounted.setRows({ items: [card(1)] })
    await mounted.settle()

    expect(mounted.board.projectId).toBe('p2')
    expect(mounted.board.projectName).toBe('Lab Two')
    expect(mounted.cards()).toEqual(['wi-p2'])
    expect(mounted.loadingTransitions()).toBe(0)
  })

  it('drops the column selection when the project changes', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    act(() => mounted.board.selectColumn('s-done'))
    expect(mounted.board.activeStateId).toBe('s-done')

    mounted.setScope(scopeFor('p2'))
    mounted.setRows({ items: [card(1)] })
    await mounted.settle()

    // The p1 selection must not carry into p2; the board falls back to p2's first column.
    expect(mounted.board.activeStateId).toBe('s-todo')
  })
})

describe('usePlaneBoard: the column metadata is the only thing it reads', () => {
  it('reads the states once and not again on a re-render with the same scope', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    expect(mounted.calls.filter((call) => call.method === 'plane.listStates')).toHaveLength(1)

    mounted.setScope(scopeFor('p1'))
    await mounted.settle()

    expect(mounted.calls.filter((call) => call.method === 'plane.listStates')).toHaveLength(1)
  })

  it('reads the states silently, so a board with cards never flashes the spinner', async () => {
    const mounted = mountBoard({ hangStates: true })
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.cards()).toEqual(['wi-p1'])
    expect(mounted.loadingTransitions()).toBe(0)
  })

  it('keeps “Move to” waiting while the columns are still only the ones the cards derive', async () => {
    const pending = mountBoard({ hangStates: true })
    await pending.settle()
    // One derived column from the card's own state; the project's real board is not here yet.
    expect(pending.board.columnsPending).toBe(true)
    expect(pending.board.columns.every((column) => column.derived)).toBe(true)

    const settled = mountBoard()
    await settled.settle()
    expect(settled.board.columnsPending).toBe(false)
    expect(settled.board.columns.map((column) => column.stateId)).toEqual(['s-todo', 's-done'])
  })

  it('surfaces a failed metadata read with the cause', async () => {
    const mounted = mountBoard({ failStates: new Error('states unreachable') })
    await mounted.settle()

    expect(mounted.board.status).toBe('error')
    expect(mounted.board.error).toBe('states unreachable')
  })

  it('retries the rows and the metadata together', async () => {
    const mounted = mountBoard({ failStates: new Error('states unreachable') })
    await mounted.settle()
    const before = mounted.calls.filter((call) => call.method === 'plane.listStates').length

    act(() => mounted.board.refresh())
    await mounted.settle()

    expect(mounted.refreshes).toBe(1)
    expect(mounted.calls.filter((call) => call.method === 'plane.listStates').length).toBe(
      before + 1
    )
  })
})

describe('usePlaneBoard: writes reconcile against a re-read of the list', () => {
  it('re-reads the list after a create, so the new card is server truth and not a guess', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    expect(mounted.refreshes).toBe(0)

    await act(async () => {
      await mounted.board.createCard('A new card')
    })
    await mounted.settle()

    // The create reply carries no card; without this the board would never show it.
    expect(mounted.refreshes).toBe(1)
  })

  it('reports the pull-to-refresh spinner the Tasks screen owns', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    expect(mounted.board.refreshing).toBe(false)

    mounted.setRows({ refreshing: true })
    expect(mounted.board.refreshing).toBe(true)
    expect(mounted.board.status).toBe('ready')
  })
})
