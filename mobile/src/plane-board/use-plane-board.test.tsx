import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
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

type MountOptions = {
  connected?: boolean
  hangWorkItems?: boolean
  capabilities?: readonly string[] | undefined
}

function mountBoard(options: MountOptions = {}) {
  const statuses: PlaneBoardStatus[] = []
  const calls: { method: string; params: unknown }[] = []
  let latest: PlaneBoard | null = null
  const reply = (result: unknown) => ({ id: '1', ok: true, result })
  const client = {
    sendRequest: (method: string, params?: unknown) => {
      calls.push({ method, params })
      switch (method) {
        case 'plane.status':
          return Promise.resolve(
            reply({ connected: true, selectedWorkspaceId: 'ws-1', workspaces: [] })
          )
        case 'plane.listProjects':
          return Promise.resolve(reply(PROJECTS))
        case 'plane.listStates':
          return Promise.resolve(reply(STATES))
        case 'plane.listWorkItems': {
          if (options.hangWorkItems) {
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

  type ProbeProps = { connected: boolean; capabilities: readonly string[] | undefined }

  function Probe({ connected, capabilities }: ProbeProps) {
    const board = usePlaneBoard(client, connected, capabilities)
    latest = board
    statuses.push(board.status)
    return null
  }

  let renderer!: ReactTestRenderer
  const props: ProbeProps = {
    connected: options.connected ?? true,
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
    /** Every status the board rendered before its first settled read. */
    beforeFirstRead(): PlaneBoardStatus[] {
      return [...new Set(statuses.slice(0, statuses.indexOf('ready')))]
    },
    setConnected(connected: boolean): void {
      props.connected = connected
      act(() => {
        renderer.update(createElement(Probe, { ...props }))
      })
    },
    setCapabilities(capabilities: readonly string[]): void {
      props.capabilities = capabilities
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

  it('stays idle when it mounts disconnected', async () => {
    const mounted = mountBoard({ connected: false })
    await mounted.settle()

    expect(mounted.board.status).toBe('idle')
    expect(mounted.board.error).toBeNull()
    expect(mounted.loadingTransitions()).toBe(0)
  })

  it('paints one spinner when a board mounted disconnected reconnects', async () => {
    const mounted = mountBoard({ connected: false })
    await mounted.settle()

    mounted.setConnected(true)
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.loadingTransitions()).toBe(1)
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(1)
  })

  it('reloads behind a spinner when the project changes', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const before = mounted.loadingTransitions()

    act(() => mounted.board.selectProject('p2'))
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

  it('does not reload when the picker taps the project already open', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const before = mounted.loadingTransitions()
    const reads = mounted.calls.filter((call) => call.method === 'plane.listWorkItems').length

    act(() => mounted.board.selectProject('p1'))
    await mounted.settle()

    expect(mounted.loadingTransitions()).toBe(before)
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(
      reads
    )
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

  it('leaves the spinner when the connection drops mid-load', async () => {
    const mounted = mountBoard({ hangWorkItems: true })
    await mounted.settle()
    expect(mounted.board.status).toBe('loading')

    mounted.setConnected(false)
    await mounted.settle()

    const stuck = mounted.board.status === 'loading' && mounted.board.error === null
    expect(stuck).toBe(false)
    expect(mounted.board.error).not.toBeNull()
  })
})

describe('usePlaneBoard while the host capability list is still pending', () => {
  it('waits behind one spinner instead of painting an empty board first', async () => {
    const mounted = mountBoard({ capabilities: undefined })
    await mounted.settle()
    expect(mounted.board.status).toBe('loading')
    expect(mounted.calls).toHaveLength(0)

    mounted.setCapabilities(CAPABILITIES)
    await mounted.settle()

    expect(mounted.beforeFirstRead()).toEqual(['loading'])
    expect(mounted.loadingTransitions()).toBe(1)
    expect(mounted.board.status).toBe('ready')
    expect(mounted.board.columns[0]?.items[0]?.id).toBe('wi-p1')
    expect(mounted.calls.filter((call) => call.method === 'plane.listWorkItems')).toHaveLength(1)
  })

  it('settles on a host that answers the capability read with nothing', async () => {
    const mounted = mountBoard({ capabilities: undefined })
    await mounted.settle()

    mounted.setCapabilities([])
    await mounted.settle()

    expect(mounted.board.status).toBe('ready')
    expect(mounted.loadingTransitions()).toBe(1)
    expect(mounted.board.emptyState).not.toBeNull()
    expect(mounted.calls).toHaveLength(0)
  })

  it('leaves the spinner when the connection drops before the list arrives', async () => {
    const mounted = mountBoard({ capabilities: undefined })
    await mounted.settle()
    expect(mounted.board.status).toBe('loading')

    mounted.setConnected(false)
    await mounted.settle()

    expect(mounted.board.status).toBe('error')
    expect(mounted.board.error).not.toBeNull()
  })
})
