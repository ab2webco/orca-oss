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
import {
  MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
} from './plane-board-writes-capability'
import { PLANE_COMMENT_UNANSWERED_MESSAGE } from './use-plane-board-comments'
import { PLANE_WRITE_UNANSWERED_MESSAGE } from './plane-write-failure'

const PHASE_1_HOST = ['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY]
const WRITING_HOST = [...PHASE_1_HOST, MOBILE_PLANE_BOARD_WRITES_CAPABILITY]
const ASSIGNING_HOST = [...WRITING_HOST, MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY]

const safeAreaMetrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 }
}

type Call = { method: string; params?: unknown }

type HostBehaviour = {
  /** Every board write rejects with this error, the way a dropped socket or a timeout does. */
  rejectWrites?: Error
  /** Only writes on this card reject; the rest succeed. */
  rejectWritesFor?: string
  /** Writes on this card never answer, a request still inside its budget. */
  hangWritesFor?: string
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
      if (
        method === 'plane.createWorkItem' ||
        method === 'plane.updateWorkItem' ||
        method === 'plane.addWorkItemComment'
      ) {
        writeAttempted = true
        const workItemId = (params as { workItemId?: string } | undefined)?.workItemId
        if (behaviour.hangWritesFor && workItemId === behaviour.hangWritesFor) {
          return new Promise(() => {})
        }
        if (
          behaviour.rejectWrites &&
          (!behaviour.rejectWritesFor || workItemId === behaviour.rejectWritesFor)
        ) {
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
        case 'plane.addWorkItemComment':
          return reply({ ok: true, id: 'c-1' })
        case 'plane.listMembers':
          return reply([
            { id: 'u-1', displayName: 'Ada' },
            { id: 'u-2', displayName: 'Grace' }
          ])
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

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Why: React ignores a plain `.value =` on a controlled input; the prototype
  // setter plus an input event is what a keystroke looks like to it.
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
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

  function callsTo(calls: Call[], method: string): Call[] {
    return calls.filter((call) => call.method === method)
  }

  async function openCard(): Promise<void> {
    act(() => byLabel('Wire the retry')!.click())
    await settle()
  }

  async function press(label: string): Promise<void> {
    await act(async () => {
      byLabel(label)!.click()
      await Promise.resolve()
    })
    await settle()
  }

  it('shows neither a priority nor an assignee control on a phase-1 host', async () => {
    const calls = await mountBoard(PHASE_1_HOST, { items: [CARD] })
    await openCard()

    expect(byLabel('Move to Doing')).not.toBeNull()
    expect(byLabel('Priority High')).toBeNull()
    expect(byLabel('Assign Ada')).toBeNull()
    expect(callsTo(calls, 'plane.listMembers')).toHaveLength(0)
  })

  it('shows the priority control but no assignee control on a host that only writes', async () => {
    // Why: lab.52-54 advertise writes.v1 and still refuse plane.listMembers, so an
    // assignee picker there would render and then fail by design.
    const calls = await mountBoard(WRITING_HOST, { items: [CARD] })
    await openCard()

    expect(byLabel('Priority High')).not.toBeNull()
    expect(byLabel('Assign Ada')).toBeNull()
    expect(callsTo(calls, 'plane.listMembers')).toHaveLength(0)
  })

  it('shows both controls and reads the members only once the detail opens', async () => {
    const calls = await mountBoard(ASSIGNING_HOST, { items: [CARD] })
    expect(callsTo(calls, 'plane.listMembers')).toHaveLength(0)
    await openCard()

    expect(byLabel('Priority High')).not.toBeNull()
    expect(byLabel('Assign Ada')).not.toBeNull()
    expect(byLabel('Assign Grace')).not.toBeNull()
    expect(callsTo(calls, 'plane.listMembers')).toEqual([
      { method: 'plane.listMembers', params: { projectId: 'proj-1', workspaceId: 'ws-1' } }
    ])
  })

  it('sets the priority from the detail and shows it on the card at once', async () => {
    const calls = await mountBoard(WRITING_HOST, { items: [CARD] })
    await openCard()
    await press('Priority High')

    expect(callsTo(calls, 'plane.updateWorkItem')).toEqual([
      {
        method: 'plane.updateWorkItem',
        params: {
          projectId: 'proj-1',
          workItemId: 'wi-1',
          workspaceId: 'ws-1',
          updates: { priority: 'high' }
        }
      }
    ])
    expect(byLabel('Priority High')?.getAttribute('aria-selected')).toBe('true')
    expect(leafWithText('High', byLabel('Wire the retry')!)).not.toBeNull()
    expect(leafWithText('Updating…')).toBeNull()
  })

  it('puts the priority back and offers a retry when the transport drops the write', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD]
    })
    await openCard()
    await press('Priority High')

    const card = byLabel('Wire the retry')!
    expect(leafWithText('High', card)).toBeNull()
    expect(byLabel('Priority High')?.getAttribute('aria-selected')).not.toBe('true')
    expect(leafWithText('Updating…')).toBeNull()
    expect(leafWithText('Could not update the card — Connection interrupted')).not.toBeNull()
    expect(callsTo(calls, 'plane.updateWorkItem')).toHaveLength(1)

    await press('Try again')
    expect(callsTo(calls, 'plane.updateWorkItem')).toHaveLength(2)
    expect(callsTo(calls, 'plane.updateWorkItem')[1]?.params).toMatchObject({
      updates: { priority: 'high' }
    })
  })

  it('re-reads the board when a priority write times out: Plane may have taken it', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: markRpcDeliveryUnknown(new Error('Request timed out: plane.updateWorkItem')),
      items: [CARD],
      itemsAfterWrite: [{ ...CARD, priority: 'high' }]
    })
    const readsBefore = readsOf(calls)
    await openCard()
    await press('Priority High')

    expect(readsOf(calls)).toBe(readsBefore + 1)
    expect(
      leafWithText(`Could not update the card — ${PLANE_WRITE_UNANSWERED_MESSAGE}`)
    ).not.toBeNull()
    // The re-read is what puts the value on the card, not the optimistic override.
    expect(leafWithText('High', byLabel('Wire the retry')!)).not.toBeNull()
  })

  it('assigns a member and sends the whole assignee list', async () => {
    const calls = await mountBoard(ASSIGNING_HOST, { items: [{ ...CARD, assignees: [] }] })
    await openCard()
    await press('Assign Ada')

    expect(callsTo(calls, 'plane.updateWorkItem')[0]?.params).toEqual({
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workspaceId: 'ws-1',
      updates: { assigneeIds: ['u-1'] }
    })
    expect(byLabel('Unassign Ada')).not.toBeNull()
    expect(leafWithText('Ada', byLabel('Wire the retry')!)).not.toBeNull()

    await press('Assign Grace')
    expect(callsTo(calls, 'plane.updateWorkItem')[1]?.params).toMatchObject({
      updates: { assigneeIds: ['u-1', 'u-2'] }
    })
  })

  it('unassigns and puts the member back when the host rejects the write', async () => {
    const calls = await mountBoard(ASSIGNING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [{ ...CARD, assignees: [{ id: 'u-1', displayName: 'Ada' }] }]
    })
    await openCard()
    expect(byLabel('Unassign Ada')).not.toBeNull()
    await press('Unassign Ada')

    expect(callsTo(calls, 'plane.updateWorkItem')[0]?.params).toMatchObject({
      updates: { assigneeIds: [] }
    })
    expect(byLabel('Unassign Ada')).not.toBeNull()
    expect(leafWithText('Ada', byLabel('Wire the retry')!)).not.toBeNull()
    expect(leafWithText('Could not update the card — Connection interrupted')).not.toBeNull()
    expect(byLabel('Try again')).not.toBeNull()
  })

  it('keeps a failed edit and its retry on the card that failed, not on the next one opened', async () => {
    const second = { ...CARD, id: 'wi-2', identifier: 'ORCA-2', title: 'Second card' }
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD, second]
    })
    await openCard()
    await press('Priority High')
    expect(leafWithText('Could not update the card — Connection interrupted')).not.toBeNull()

    // Switching cards: the list stays mounted under the sheet, so a click on the
    // other card is what closing and reopening looks like to the screen.
    act(() => byLabel('Second card')!.click())
    await settle()
    expect(leafWithText('Could not update the card — Connection interrupted')).toBeNull()
    expect(byLabel('Try again')).toBeNull()

    await openCard()
    expect(leafWithText('Could not update the card — Connection interrupted')).not.toBeNull()
    await press('Try again')
    expect(callsTo(calls, 'plane.updateWorkItem')).toHaveLength(2)
    expect(callsTo(calls, 'plane.updateWorkItem')[1]?.params).toMatchObject({
      workItemId: 'wi-1',
      updates: { priority: 'high' }
    })
  })

  // A multiline TextInput is a textarea on the web.
  function commentInput(): HTMLTextAreaElement {
    const input = byLabel('Comment')
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error('comment input is not mounted')
    }
    return input
  }

  async function postComment(body: string): Promise<HTMLTextAreaElement> {
    expect(byLabel('Post comment')).not.toBeNull()
    const input = commentInput()
    typeInto(input, body)
    await press('Post comment')
    return input
  }

  const COMMENT_DROPPED = 'Could not post the comment — Connection interrupted'

  it('shows no comment composer at all on a phase-1 host', async () => {
    await mountBoard(PHASE_1_HOST, { items: [CARD] })
    await openCard()

    expect(byLabel('Move to Doing')).not.toBeNull()
    expect(byLabel('Comment')).toBeNull()
    expect(byLabel('Post comment')).toBeNull()
  })

  it('posts a comment on the open card and clears the draft', async () => {
    const calls = await mountBoard(WRITING_HOST, { items: [CARD] })
    await openCard()
    const input = await postComment('Looks good')

    expect(callsTo(calls, 'plane.addWorkItemComment')).toEqual([
      {
        method: 'plane.addWorkItemComment',
        params: { projectId: 'proj-1', workItemId: 'wi-1', body: 'Looks good', workspaceId: 'ws-1' }
      }
    ])
    expect(input.value).toBe('')
    expect(leafWithText('Posting…')).toBeNull()
    expect(leafWithText('Comment posted')).not.toBeNull()
  })

  it('keeps the draft and offers a retry when the transport drops the comment', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD]
    })
    await openCard()
    const input = await postComment('Looks good')

    expect(leafWithText('Posting…')).toBeNull()
    expect(leafWithText(COMMENT_DROPPED)).not.toBeNull()
    expect(byLabel('Try again')).not.toBeNull()
    expect(input.value).toBe('Looks good')
    // Recoverable, not hung: the PM can edit and post again.
    expect(byLabel('Post comment')?.getAttribute('aria-disabled')).not.toBe('true')
    expect(callsTo(calls, 'plane.addWorkItemComment')).toHaveLength(1)

    // Editing the draft retires the retry: it would resend the old body over the new one.
    typeInto(input, 'Looks good, ship it')
    expect(byLabel('Try again')).toBeNull()
  })

  it('offers no blind retry when a comment times out: Plane may hold it, and nothing on the board would show it', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: markRpcDeliveryUnknown(
        new Error('Request timed out: plane.addWorkItemComment')
      ),
      items: [CARD]
    })
    await openCard()
    const readsBefore = readsOf(calls)
    const input = await postComment('Looks good')

    expect(readsOf(calls)).toBe(readsBefore)
    expect(
      leafWithText(`Could not post the comment — ${PLANE_COMMENT_UNANSWERED_MESSAGE}`)
    ).not.toBeNull()
    // A one-tap retry would post it twice if the host did take it; the draft stays
    // so the PM can check the card in Plane and post again on purpose.
    expect(byLabel('Try again')).toBeNull()
    expect(input.value).toBe('Looks good')
    expect(byLabel('Post comment')?.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('keeps a failed comment and its retry on the card that failed, not on the next one opened', async () => {
    const second = { ...CARD, id: 'wi-2', identifier: 'ORCA-2', title: 'Second card' }
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD, second]
    })
    await openCard()
    await postComment('Looks good')
    expect(leafWithText(COMMENT_DROPPED)).not.toBeNull()

    act(() => byLabel('Second card')!.click())
    await settle()
    expect(leafWithText(COMMENT_DROPPED)).toBeNull()
    expect(byLabel('Try again')).toBeNull()

    await openCard()
    expect(leafWithText(COMMENT_DROPPED)).not.toBeNull()
    await press('Try again')
    expect(callsTo(calls, 'plane.addWorkItemComment')).toHaveLength(2)
    expect(callsTo(calls, 'plane.addWorkItemComment')[1]?.params).toMatchObject({
      workItemId: 'wi-1',
      body: 'Looks good'
    })
  })

  it('keeps a failed comment, its text and its retry through a successful post on another card', async () => {
    const second = { ...CARD, id: 'wi-2', identifier: 'ORCA-2', title: 'Second card' }
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      rejectWritesFor: 'wi-1',
      items: [CARD, second]
    })
    await openCard()
    await postComment('Looks good')
    expect(leafWithText(COMMENT_DROPPED)).not.toBeNull()

    act(() => byLabel('Second card')!.click())
    await settle()
    await postComment('Fine by me')
    expect(leafWithText('Comment posted')).not.toBeNull()

    // The other card's success is not this card's: the failed text is the only
    // copy the PM has, so it comes back with its error and its retry.
    await openCard()
    expect(leafWithText(COMMENT_DROPPED)).not.toBeNull()
    expect(commentInput().value).toBe('Looks good')
    await press('Try again')
    expect(callsTo(calls, 'plane.addWorkItemComment').map((call) => call.params)).toMatchObject([
      { workItemId: 'wi-1', body: 'Looks good' },
      { workItemId: 'wi-2', body: 'Fine by me' },
      { workItemId: 'wi-1', body: 'Looks good' }
    ])
  })

  it('keeps a card posting while its request is in flight, even after another card settles', async () => {
    const second = { ...CARD, id: 'wi-2', identifier: 'ORCA-2', title: 'Second card' }
    await mountBoard(WRITING_HOST, { hangWritesFor: 'wi-1', items: [CARD, second] })
    await openCard()
    await postComment('Looks good')
    expect(leafWithText('Posting…')).not.toBeNull()

    act(() => byLabel('Second card')!.click())
    await settle()
    await postComment('Fine by me')
    expect(leafWithText('Comment posted')).not.toBeNull()

    // A settled post elsewhere must not re-enable this card's button: a second
    // tap would post the same comment twice.
    await openCard()
    expect(leafWithText('Posting…')).not.toBeNull()
    expect(byLabel('Post comment')?.getAttribute('aria-disabled')).toBe('true')
  })
})
