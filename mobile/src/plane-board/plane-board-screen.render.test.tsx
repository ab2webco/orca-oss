import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'

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
import { PLANE_WRITE_UNANSWERED_MESSAGE } from './plane-write-failure'

const PHASE_1_HOST = ['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY]
const WRITING_HOST = [...PHASE_1_HOST, MOBILE_PLANE_BOARD_WRITES_CAPABILITY]

const safeAreaMetrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 }
}

type Call = { method: string; params?: unknown }

type HostBehaviour = {
  /** Every board write rejects with this error, the way a dropped socket or a timeout does. */
  rejectWrites?: Error
  items?: readonly unknown[]
  /** What a re-read returns once a write was attempted: what Plane really holds. */
  itemsAfterWrite?: readonly unknown[]
}

const CARD = {
  id: 'wi-1',
  identifier: 'ORCA-1',
  title: 'Wire the retry',
  url: '',
  project: { id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' },
  state: { id: 'state-1', name: 'Todo', group: 'unstarted' },
  priority: 'none',
  updatedAt: ''
}

function createClient(
  capabilities: readonly string[],
  calls: Call[],
  behaviour: HostBehaviour = {}
): RpcClient {
  let writeAttempted = false
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      const reply = (result: unknown) => ({ id: '1', ok: true as const, result })
      if (method === 'plane.createWorkItem' || method === 'plane.updateWorkItem') {
        writeAttempted = true
        if (behaviour.rejectWrites) {
          throw behaviour.rejectWrites
        }
      }
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
          return reply((writeAttempted && behaviour.itemsAfterWrite) || behaviour.items || [])
        case 'plane.createWorkItem':
          return reply({ ok: true, id: 'wi-9', identifier: 'ORCA-9', url: '' })
        case 'plane.updateWorkItem':
          return reply({ ok: true })
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

  async function settle(): Promise<void> {
    for (let hop = 0; hop < 12; hop += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  async function mountBoard(
    capabilities: readonly string[],
    behaviour: HostBehaviour = {}
  ): Promise<Call[]> {
    const calls: Call[] = []
    hostClient.client = createClient(capabilities, calls, behaviour)
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
    await settle()
    if (!calls.some((call) => call.method === 'plane.listStates')) {
      throw new Error('board did not finish loading')
    }
    return calls
  }

  async function submitNewCard(title: string): Promise<HTMLInputElement> {
    act(() => byLabel('Add card')!.click())
    const input = byLabel('Card title')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('card title input is not mounted')
    }
    typeInto(input, title)
    await act(async () => {
      byLabel('Create card')!.click()
      await Promise.resolve()
    })
    await settle()
    return input
  }

  function readsOf(calls: Call[]): number {
    return calls.filter((call) => call.method === 'plane.listWorkItems').length
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

  it('lets the PM retry a create the transport dropped, draft intact', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted')
    })
    const input = await submitNewCard('Ship the create drawer')

    // The control for main: the sheet stayed on "Creating…" with no way out.
    expect(leafWithText('Creating…')).toBeNull()
    expect(leafWithText('Connection interrupted')).not.toBeNull()
    expect(input.value).toBe('Ship the create drawer')
    const retry = byLabel('Create card')
    expect(retry?.getAttribute('aria-disabled')).not.toBe('true')
    expect(leafWithText('Try again', retry!)).not.toBeNull()
    expect(calls.filter((call) => call.method === 'plane.createWorkItem')).toHaveLength(1)
  })

  it('re-reads the board when a create times out and offers a retry only if the card is not there', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: markRpcDeliveryUnknown(new Error('Request timed out: plane.createWorkItem'))
    })
    const readsBeforeCreate = readsOf(calls)
    await submitNewCard('Ship the create drawer')

    expect(readsOf(calls)).toBe(readsBeforeCreate + 1)
    expect(leafWithText('Creating…')).toBeNull()
    expect(leafWithText(PLANE_WRITE_UNANSWERED_MESSAGE)).not.toBeNull()
    expect(leafWithText('Try again')).not.toBeNull()
  })

  it('treats an unanswered create as done when the re-read shows the card: no second card', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: markRpcDeliveryUnknown(new Error('Request timed out: plane.createWorkItem')),
      itemsAfterWrite: [
        { ...CARD, id: 'wi-9', identifier: 'ORCA-9', title: 'Ship the create drawer' }
      ]
    })
    await submitNewCard('Ship the create drawer')

    // The sheet closed as a success would; the board shows the card Plane holds.
    expect(byLabel('Card title')).toBeNull()
    expect(leafWithText('Try again')).toBeNull()
    expect(byLabel('Todo, 1 cards')).not.toBeNull()
    expect(calls.filter((call) => call.method === 'plane.createWorkItem')).toHaveLength(1)
  })

  it('re-reads the board when a move times out: Plane may have taken it', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: markRpcDeliveryUnknown(new Error('Request timed out: plane.updateWorkItem')),
      items: [CARD]
    })
    const readsBeforeMove = readsOf(calls)
    act(() => byLabel('Wire the retry')!.click())
    await act(async () => {
      byLabel('Move to Doing')!.click()
      await Promise.resolve()
    })
    await settle()

    expect(readsOf(calls)).toBe(readsBeforeMove + 1)
    expect(leafWithText('Moving…')).toBeNull()
    expect(byLabel('Todo, 1 cards')).not.toBeNull()
    expect(
      leafWithText(`Could not move the card — ${PLANE_WRITE_UNANSWERED_MESSAGE}`)
    ).not.toBeNull()
  })

  it('puts the card back and says so when the move is dropped by the transport', async () => {
    await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD]
    })
    expect(byLabel('Todo, 1 cards')).not.toBeNull()

    act(() => byLabel('Wire the retry')!.click())
    await act(async () => {
      byLabel('Move to Doing')!.click()
      await Promise.resolve()
    })
    await settle()

    // The control for main: the card sat in Doing under "Moving…" forever.
    expect(leafWithText('Moving…')).toBeNull()
    expect(byLabel('Todo, 1 cards')).not.toBeNull()
    expect(byLabel('Doing, 0 cards')).not.toBeNull()
    expect(leafWithText('Could not move the card — Connection interrupted')).not.toBeNull()
  })
})
