import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
// Why: react-native-webview ships untranspiled native source; the sheet's markdown renders no diagram here.
vi.mock('react-native-webview', () => ({ WebView: () => null }))
vi.mock(
  '@react-native-async-storage/async-storage',
  () => import('../../test-doubles/async-storage-memory')
)

import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import {
  MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
} from './plane-board-writes-capability'
import { PLANE_COMMENT_UNANSWERED_MESSAGE } from './use-plane-board-comments'
import { PLANE_WRITE_UNANSWERED_MESSAGE } from './plane-write-failure'
import {
  boardColumn,
  byLabel,
  callsTo,
  CARD,
  cardText,
  deviceStorage,
  leafWithText,
  mountBoard as mountBoardWith,
  openCard,
  press,
  readsOf,
  settle,
  typeInto,
  type HostBehaviour
} from '../../test-doubles/plane-tasks-harness'

const PHASE_1_HOST = ['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY]
const WRITING_HOST = [...PHASE_1_HOST, MOBILE_PLANE_BOARD_WRITES_CAPABILITY]
const ASSIGNING_HOST = [...WRITING_HOST, MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY]

/** The writes the ORCA-367 slices bought, exercised through the board view of the Tasks screen. */
describe('Plane board writes on the Tasks screen (react-native-web)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    deviceStorage.entries.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const mountBoard = (capabilities: readonly string[], behaviour: HostBehaviour = {}) =>
    mountBoardWith(root, capabilities, behaviour)

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

  it('shows no add button at all on a host that would refuse the create', async () => {
    await mountBoard(PHASE_1_HOST)

    expect(boardColumn('Todo')).toEqual({ count: 0 })
    expect(byLabel('Add card')).toBeNull()
  })

  it('creates a card in the column being looked at on a host that advertises writes', async () => {
    const calls = await mountBoard(WRITING_HOST)
    const readsBeforeCreate = readsOf(calls)
    const addButton = byLabel('Add card')
    expect(addButton).not.toBeNull()

    act(() => addButton!.click())
    // The column header also says "Todo"; only the sheet says it under "New card".
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
    await settle()

    expect(callsTo(calls, 'plane.createWorkItem')).toEqual([
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
    expect(readsOf(calls)).toBe(readsBeforeCreate + 1)
  })

  it('lets the PM retry a create the transport dropped, draft intact', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted')
    })
    const input = await submitNewCard('Ship the create drawer')

    expect(leafWithText('Creating…')).toBeNull()
    expect(leafWithText('Connection interrupted')).not.toBeNull()
    expect(input.value).toBe('Ship the create drawer')
    const retry = byLabel('Create card')
    expect(retry?.getAttribute('aria-disabled')).not.toBe('true')
    expect(leafWithText('Try again', retry!)).not.toBeNull()
    expect(callsTo(calls, 'plane.createWorkItem')).toHaveLength(1)
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

    expect(byLabel('Card title')).toBeNull()
    expect(leafWithText('Try again')).toBeNull()
    expect(boardColumn('Todo')).toEqual({ count: 1 })
    expect(callsTo(calls, 'plane.createWorkItem')).toHaveLength(1)
  })

  it('re-reads the board when a move times out: Plane may have taken it', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: markRpcDeliveryUnknown(new Error('Request timed out: plane.updateWorkItem')),
      items: [CARD]
    })
    const readsBeforeMove = readsOf(calls)
    await openCard()
    await press('Move to Doing')

    expect(readsOf(calls)).toBe(readsBeforeMove + 1)
    expect(leafWithText('Moving…')).toBeNull()
    expect(boardColumn('Todo')).toEqual({ count: 1 })
    expect(
      leafWithText(`Could not move the card — ${PLANE_WRITE_UNANSWERED_MESSAGE}`)
    ).not.toBeNull()
  })

  it('puts the card back and says so when the move is dropped by the transport', async () => {
    await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD]
    })
    expect(boardColumn('Todo')).toEqual({ count: 1 })

    await openCard()
    await press('Move to Doing')

    expect(leafWithText('Moving…')).toBeNull()
    expect(boardColumn('Todo')).toEqual({ count: 1 })
    expect(boardColumn('Doing')).toEqual({ count: 0 })
    expect(leafWithText('Could not move the card — Connection interrupted')).not.toBeNull()
  })

  it('says a card is moving on the card itself while its write is in flight', async () => {
    await mountBoard(WRITING_HOST, { hangWritesFor: 'wi-1', items: [CARD] })
    await openCard()
    await press('Move to Doing')

    expect(boardColumn('Doing')).toEqual({ count: 1 })
    expect(cardText('Wire the retry')).toContain('Moving…')
  })

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
    expect(cardText('Wire the retry')).toContain('High')
    expect(leafWithText('Updating…')).toBeNull()
  })

  it('puts the priority back and offers a retry when the transport drops the write', async () => {
    const calls = await mountBoard(WRITING_HOST, {
      rejectWrites: new Error('Connection interrupted'),
      items: [CARD]
    })
    await openCard()
    await press('Priority High')

    expect(cardText('Wire the retry')).not.toContain('High')
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
    expect(cardText('Wire the retry')).toContain('High')
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
    expect(cardText('Wire the retry')).toContain('Ada')

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
    expect(cardText('Wire the retry')).toContain('Ada')
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
    await press('Open Second card')
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

    await press('Open Second card')
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

    await press('Open Second card')
    await postComment('Fine by me')
    expect(leafWithText('Comment posted')).not.toBeNull()

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

    await press('Open Second card')
    await postComment('Fine by me')
    expect(leafWithText('Comment posted')).not.toBeNull()

    await openCard()
    expect(leafWithText('Posting…')).not.toBeNull()
    expect(byLabel('Post comment')?.getAttribute('aria-disabled')).toBe('true')
  })
})
