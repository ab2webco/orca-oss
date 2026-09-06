import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'
import type { PlaneBoardScope } from './plane-board-scope'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { usePlaneBoard, type PlaneBoard, type PlaneBoardRows } from './use-plane-board'

const CAPABILITIES = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]

const CARD = {
  id: 'wi-1',
  identifier: 'ORCA-1',
  title: 'One',
  url: 'https://plane.example/wi-1',
  project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
  state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
  priority: 'none',
  updatedAt: '2026-09-04T00:00:00.000Z'
}

const SCOPE: PlaneBoardScope = {
  enabled: true,
  planeConnected: true,
  workspaceId: 'ws-1',
  projectId: CARD.project.id,
  projectName: CARD.project.name,
  filter: 'all',
  query: ''
}

// The Tasks screen owns the rows; the board projects them (ORCA-417).
const ROWS: PlaneBoardRows = {
  items: [CARD as unknown as PlaneMobileWorkItem],
  loading: false,
  refreshing: false,
  refresh: async () => [CARD as unknown as PlaneMobileWorkItem]
}

type Deferred = { resolve: (result: unknown) => void; reject: (error: Error) => void }

/** Reads answer at once; every board write waits until the test releases it. */
function mountBoard() {
  const writes: Deferred[] = []
  let latest: PlaneBoard | null = null
  const reply = (result: unknown) => ({ id: '1', ok: true, result })
  const client = {
    sendRequest: (method: string) => {
      switch (method) {
        case 'plane.status':
          return Promise.resolve(
            reply({ connected: true, selectedWorkspaceId: 'ws-1', workspaces: [] })
          )
        case 'plane.listProjects':
          return Promise.resolve(reply([CARD.project]))
        case 'plane.listStates':
          return Promise.resolve(
            reply([
              { id: 's-todo', name: 'Todo', group: 'unstarted', sequence: 1 },
              { id: 's-doing', name: 'Doing', group: 'started', sequence: 2 },
              { id: 's-done', name: 'Done', group: 'completed', sequence: 3 }
            ])
          )
        case 'plane.listWorkItems':
          return Promise.resolve(reply([CARD]))
        case 'plane.updateWorkItem':
          return new Promise((resolve, reject) => {
            writes.push({ resolve: (result) => resolve(reply(result)), reject })
          })
        default:
          return new Promise(() => {})
      }
    }
  } as unknown as RpcClient

  function Probe() {
    latest = usePlaneBoard(client, CAPABILITIES, SCOPE, ROWS)
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
  return {
    writes,
    get board(): PlaneBoard {
      if (!latest) {
        throw new Error('probe never rendered')
      }
      return latest
    },
    columnOf(workItemId: string): string | undefined {
      return this.board.columns.find((column) =>
        column.items.some((item) => item.id === workItemId)
      )?.stateId
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

describe('usePlaneBoard with two moves in flight on one card', () => {
  it('leaves the card where the accepted move put it when the earlier one is refused', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const card = mounted.board.columns[0]?.items[0]
    if (!card) {
      throw new Error('board did not load the card')
    }

    act(() => void mounted.board.moveWorkItem(card, 's-doing'))
    const cardInDoing = mounted.board.columns[1]?.items[0]
    if (!cardInDoing) {
      throw new Error('the first move did not show on the board')
    }
    act(() => void mounted.board.moveWorkItem(cardInDoing, 's-done'))
    expect(mounted.writes).toHaveLength(2)

    mounted.writes[1]?.resolve({ ok: true })
    await mounted.settle()
    mounted.writes[0]?.reject(new Error('Column is locked'))
    await mounted.settle()

    expect(mounted.columnOf('wi-1')).toBe('s-done')
    expect(mounted.board.moveError).toBe('Column is locked')
  })

  it('puts a refused second move back on the first one still pending', async () => {
    const mounted = mountBoard()
    await mounted.settle()
    const card = mounted.board.columns[0]?.items[0]
    if (!card) {
      throw new Error('board did not load the card')
    }

    act(() => void mounted.board.moveWorkItem(card, 's-doing'))
    const cardInDoing = mounted.board.columns[1]?.items[0]
    if (!cardInDoing) {
      throw new Error('the first move did not show on the board')
    }
    act(() => void mounted.board.moveWorkItem(cardInDoing, 's-done'))

    mounted.writes[1]?.reject(new Error('Column is locked'))
    await mounted.settle()

    expect(mounted.columnOf('wi-1')).toBe('s-doing')
    expect([...mounted.board.movingWorkItemIds]).toEqual(['wi-1'])
  })
})
