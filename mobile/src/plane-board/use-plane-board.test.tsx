import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
import type { PlaneBoardScope } from './plane-board-scope'
import { usePlaneBoard, type PlaneBoard, type PlaneBoardStatus } from './use-plane-board'

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

function card(projectIndex: number) {
  const project = PROJECTS[projectIndex]!
  return {
    id: `wi-${project.id}`,
    identifier: `${project.identifier}-1`,
    title: `Card of ${project.name}`,
    url: `https://plane.example/wi-${project.id}`,
    project,
    state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
    priority: 'none',
    updatedAt: '2026-09-04T00:00:00.000Z'
  }
}

// The board reads a scope the Tasks screen owns; it no longer fetches status or the
// project list itself, so a change of project or connection is a scope prop change.
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
  hangWorkItems?: boolean
  /** Resolve the first N listWorkItems reads, then hang — models a refresh that never returns. */
  hangWorkItemsAfter?: number
  capabilities?: readonly string[] | undefined
}

function mountBoard(options: MountOptions = {}) {
  const statuses: PlaneBoardStatus[] = []
  const calls: { method: string; params: unknown }[] = []
  let latest: PlaneBoard | null = null
  let workItemReads = 0
  const reply = (result: unknown) => ({ id: '1', ok: true, result })
  const client = {
    sendRequest: (method: string, params?: unknown) => {
      calls.push({ method, params })
      switch (method) {
        case 'plane.listStates':
          return Promise.resolve(reply(STATES))
        case 'plane.listWorkItems': {
          workItemReads += 1
          if (options.hangWorkItems || (options.hangWorkItemsAfter ?? Infinity) < workItemReads) {
            return new Promise(() => {})
          }
          const projectId = (params as { projectId?: string } | undefined)?.projectId
          return Promise.resolve(reply([card(projectId === 'p2' ? 1 : 0)]))
        }
        default:
          return new Promise(() => {})
      }
    }
  } as unknown as RpcClient

  type ProbeProps = { scope: PlaneBoardScope; capabilities: readonly string[] | undefined }

  function Probe({ scope, capabilities }: ProbeProps) {
    const board = usePlaneBoard(client, capabilities, scope)
    latest = board
    statuses.push(board.status)
    return null
  }

  let renderer!: ReactTestRenderer
  const props: ProbeProps = {
    scope: options.scope ?? scopeFor('p1'),
    capabilities: 'capabilities' in options ? options.capabilities : CAPABILITIES
  }
  act(() => {
    renderer = create(createElement(Probe, props))
  })

  return {
    statuses,
    calls,
    get board(): PlaneBoard {
      if (!latest) {
        throw new Error('probe never rendered')
      }
      return latest
    },
    /** Counts entries where status became 'loading', i.e. spinner repaints. */
    loadingTransitions(): number {
      return statuses.filter((entry, index) => entry === 'loading' && statuses[index - 1] !== entry)
        .length
    },
    setScope(scope: PlaneBoardScope): void {
      props.scope = scope
      act(() => {
        renderer.update(createElement(Probe, { ...props }))
      })
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

describe('usePlaneBoard load lifecycle', () => {
  it('paints the spinner once for one mount', async () => {
    const mounted = mountBoard()
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.loadingTransitions()).toBe(1)
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(1)
  })

  it('starts the very first render on the spinner, so no empty board flashes before the read', async () => {
    // ORCA-387: a mount that is going to read must open on 'loading', not settle 'idle'
    // for a frame and paint an empty board first. Read before settle: this is the mount render.
    const mounted = mountBoard()
    expect(mounted.statuses[0]).toBe('loading')

    await mounted.settle()
    expect(mounted.board.status).toBe('ready')
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
    // The hook no longer probes the host itself; the caller passes planeConnected, so a host
    // that reports no Plane arrives here as planeConnected=false. It must settle showing the
    // cause, not spin and not read (the behavior main covered inside the hook's capability read).
    const mounted = mountBoard({ scope: scopeFor('p1', { planeConnected: false }) })
    expect(mounted.statuses[0]).toBe('idle')

    await mounted.settle()

    expect(mounted.board.status).toBe('idle')
    expect(mounted.board.error).toBeNull()
    expect(mounted.board.emptyState?.kind).toBe('disconnected')
    expect(mounted.loadingTransitions()).toBe(0)
    expect(mounted.calls).toHaveLength(0)
  })

  it('paints one spinner when a board mounted disconnected reconnects', async () => {
    const mounted = mountBoard({ scope: scopeFor('p1', { planeConnected: false }) })
    await mounted.settle()

    mounted.setScope(scopeFor('p1'))
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.loadingTransitions()).toBe(1)
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(1)
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

  it('reloads behind a spinner when the project changes', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const before = mounted.loadingTransitions()

    mounted.setScope(scopeFor('p2'))
    await mounted.settle()

    expect(mounted.loadingTransitions()).toBe(before + 1)
    expect(mounted.board.projectId).toBe('p2')
    expect(mounted.board.projectName).toBe('Lab Two')
    expect(mounted.board.columns[0]?.items[0]?.id).toBe('wi-p2')
    expect(
      mounted.calls
        .filter((call) => call.method === 'plane.listWorkItems')
        .map((call) => (call.params as { projectId?: string }).projectId)
    ).toContain('p2')
  })

  it('does not reload when it re-renders with the same scope', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const before = mounted.loadingTransitions()
    const reads = mounted.calls.filter((call) => call.method === 'plane.listWorkItems').length

    mounted.setScope(scopeFor('p1'))
    await mounted.settle()

    expect(mounted.loadingTransitions()).toBe(before)
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(
      reads
    )
  })

  it('clears the pull-to-refresh spinner if the connection drops while a refresh is in flight', async () => {
    // First read resolves (ready); the refresh below hangs, so refreshing stays true until
    // the disconnect. The superseded read never runs its finally, so the guard must clear it.
    const mounted = mountBoard({ hangWorkItemsAfter: 1 })
    await mounted.settle()
    expect(mounted.board.status).toBe('ready')

    act(() => mounted.board.refresh())
    await mounted.settle()
    expect(mounted.board.refreshing).toBe(true)

    mounted.setScope(scopeFor('p1', { planeConnected: false }))
    await mounted.settle()
    expect(mounted.board.refreshing).toBe(false)
  })

  it('refreshes without repainting the spinner', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const before = mounted.loadingTransitions()

    act(() => mounted.board.refresh())
    await mounted.settle()

    expect(mounted.loadingTransitions()).toBe(before)
    expect(mounted.board.status).toBe('ready')
    expect(mounted.board.refreshing).toBe(false)
  })

  it('leaves the spinner for an error when the connection drops mid-load', async () => {
    const mounted = mountBoard({ hangWorkItems: true })
    await mounted.settle()
    expect(mounted.board.status).toBe('loading')

    mounted.setScope(scopeFor('p1', { planeConnected: false }))
    await mounted.settle()

    const stuck = mounted.board.status === 'loading' && mounted.board.error === null
    expect(stuck).toBe(false)
    expect(mounted.board.status).toBe('error')
    expect(mounted.board.error).not.toBeNull()
  })

  it('never renders one project’s rows under another while the new read is in flight', async () => {
    // Guard: current = loaded.projectId === projectId ? loaded : EMPTY_LOADED. p1 resolves,
    // p2 hangs; the cached p1 rows must not show under p2.
    const mounted = mountBoard({ hangWorkItemsAfter: 1 })
    await mounted.settle()
    expect(mounted.board.columns.flatMap((column) => column.items).map((item) => item.id)).toEqual([
      'wi-p1'
    ])

    mounted.setScope(scopeFor('p2'))
    await mounted.settle()

    expect(mounted.board.status).toBe('loading')
    expect(mounted.board.columns.flatMap((column) => column.items)).toHaveLength(0)
  })

  it('drops the column selection when the project changes', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    act(() => mounted.board.selectColumn('s-done'))
    expect(mounted.board.activeStateId).toBe('s-done')

    mounted.setScope(scopeFor('p2'))
    await mounted.settle()

    // The p1 selection must not carry into p2; the board falls back to p2's first column.
    expect(mounted.board.activeStateId).toBe('s-todo')
  })
})
