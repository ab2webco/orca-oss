import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { RpcClient } from '../transport/rpc-client'

// Why: lucide's circular ESM re-exports do not load under Vite's runner; icons are not under test.
vi.mock('lucide-react-native', async () => {
  const { createElement: h } = await import('react')
  const Icon = () => h('span')
  return new Proxy(
    {},
    {
      get: (_target, name) => (typeof name === 'string' && name !== 'then' ? Icon : undefined),
      has: (_target, name) => typeof name === 'string' && name !== 'then'
    }
  )
})
vi.mock('expo-router', () => ({
  useRouter: () => ({ back: () => {} }),
  useLocalSearchParams: () => ({ hostId: 'host-1' })
}))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
const hostClient = vi.hoisted(() => ({ client: null as RpcClient | null }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: hostClient.client, state: 'connected' })
}))

import PlaneBoardScreen from '../../app/h/[hostId]/plane-board'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import { MOBILE_PLANE_BOARD_WRITES_CAPABILITY } from './plane-board-writes-capability'

const PHASE_1_HOST = ['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY]
const WRITING_HOST = [...PHASE_1_HOST, MOBILE_PLANE_BOARD_WRITES_CAPABILITY]

const safeAreaMetrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 }
}

type Call = { method: string; params?: unknown }

function createClient(capabilities: readonly string[], calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      const reply = (result: unknown) => ({ id: '1', ok: true as const, result })
      switch (method) {
        case 'status.get':
          return reply({ hostPlatform: 'darwin', capabilities })
        case 'plane.status':
          return reply({
            connected: true,
            selectedWorkspaceId: 'ws-1',
            workspaces: [{ id: 'ws-1', workspaceSlug: 'orca' }]
          })
        case 'plane.listProjects':
          return reply([{ id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' }])
        case 'plane.listStates':
          return reply([
            { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
            { id: 'state-2', name: 'Doing', group: 'started', sequence: 2 }
          ])
        case 'plane.listWorkItems':
          return reply([])
        case 'plane.createWorkItem':
          return reply({ ok: true, id: 'wi-9', identifier: 'ORCA-9', url: '' })
        default:
          return new Promise(() => {})
      }
    })
  } as unknown as RpcClient
}

function byLabel(label: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
}

function leafWithText(text: string, scope: ParentNode = document.body): HTMLElement | null {
  for (const element of scope.querySelectorAll<HTMLElement>('div')) {
    if (element.childElementCount === 0 && element.textContent === text) {
      return element
    }
  }
  return null
}

function typeInto(input: HTMLInputElement, value: string): void {
  // Why: React ignores a plain `.value =` on a controlled input; the prototype
  // setter plus an input event is what a keystroke looks like to it.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) {
    throw new Error('HTMLInputElement has no value setter')
  }
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('PlaneBoardScreen create card (react-native-web)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    hostClient.client = null
  })

  async function mountBoard(capabilities: readonly string[]): Promise<Call[]> {
    const calls: Call[] = []
    hostClient.client = createClient(capabilities, calls)
    await act(async () => {
      root.render(
        createElement(
          SafeAreaProvider,
          { initialMetrics: safeAreaMetrics },
          createElement(PlaneBoardScreen)
        )
      )
    })
    // The board reads status.get, plane.status, projects, then states + items;
    // each hop is a microtask boundary.
    for (let hop = 0; hop < 12; hop += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
    if (!calls.some((call) => call.method === 'plane.listStates')) {
      throw new Error('board did not finish loading')
    }
    return calls
  }

  it('shows no add button at all on a host that would refuse the create', async () => {
    await mountBoard(PHASE_1_HOST)

    // The screen is up (project picker rendered) and the columns loaded.
    expect(byLabel('Choose project')).not.toBeNull()
    expect(byLabel('Todo, 0 cards')).not.toBeNull()
    expect(byLabel('Add card')).toBeNull()
  })

  it('creates a card in the column being looked at on a host that advertises writes', async () => {
    const calls = await mountBoard(WRITING_HOST)
    const readsBeforeCreate = calls.filter((call) => call.method === 'plane.listWorkItems').length
    const addButton = byLabel('Add card')
    expect(addButton).not.toBeNull()

    act(() => addButton!.click())
    // The column chip also says "Todo"; only the sheet says it under "New card".
    const sheet = leafWithText('New card')?.parentElement
    expect(sheet).not.toBeNull()
    expect(leafWithText('Todo', sheet!)).not.toBeNull()
    const input = byLabel('Card title')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('card title input is not mounted')
    }
    typeInto(input, 'Ship the create drawer')
    await act(async () => {
      byLabel('Create card')!.click()
      await Promise.resolve()
    })
    for (let hop = 0; hop < 6; hop += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(calls.filter((call) => call.method === 'plane.createWorkItem')).toEqual([
      {
        method: 'plane.createWorkItem',
        params: {
          projectId: 'proj-1',
          workspaceId: 'ws-1',
          title: 'Ship the create drawer',
          stateId: 'state-1'
        }
      }
    ])
    // The board re-reads so the new card shows up without a manual refresh.
    expect(calls.filter((call) => call.method === 'plane.listWorkItems').length).toBe(
      readsBeforeCreate + 1
    )
  })
})
