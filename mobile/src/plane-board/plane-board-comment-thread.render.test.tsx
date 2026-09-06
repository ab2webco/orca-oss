import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Linking } from 'react-native'
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
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
// Why: react-native-webview ships untranspiled native source; comment bodies render no diagram.
vi.mock('react-native-webview', () => ({ WebView: () => null }))
vi.mock(
  '@react-native-async-storage/async-storage',
  () => import('../../test-doubles/async-storage-memory')
)

import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { PlaneTasksHarness } from '../../test-doubles/plane-tasks-harness'
import { MOBILE_TASKS_PLANE_CAPABILITY } from '../tasks/plane-mobile-task-source'
import {
  MOBILE_PLANE_BOARD_COMMENT_READS_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
} from './plane-board-writes-capability'

const WRITING_HOST = [
  'mobile.tasks.v1',
  MOBILE_TASKS_PLANE_CAPABILITY,
  MOBILE_PLANE_BOARD_WRITES_CAPABILITY
]
const READING_HOST = [...WRITING_HOST, MOBILE_PLANE_BOARD_COMMENT_READS_CAPABILITY]

type Call = { method: string; params?: unknown }

type ThreadReply =
  /** What the host answers for the thread; `hang` is a request still in flight. */
  { kind: 'thread'; comments: unknown[] } | { kind: 'failed'; error: string } | { kind: 'hang' }

const CARD = {
  id: 'wi-1',
  identifier: 'ORCA-1',
  title: 'Wire the retry',
  description: 'Steps to reproduce, straight from the ticket body.',
  url: '',
  project: { id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' },
  state: { id: 'state-1', name: 'Todo', group: 'unstarted' },
  priority: 'none',
  updatedAt: ''
}

const COMMENT = {
  id: 'c-1',
  body: 'Reproduced on 0.0.47.',
  createdAt: new Date().toISOString(),
  user: { id: 'u-1', displayName: 'Ada' }
}

function createClient(
  capabilities: readonly string[],
  calls: Call[],
  replies: ThreadReply[]
): RpcClient {
  let read = 0
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
          return reply([CARD])
        case 'plane.addWorkItemComment':
          return reply({ ok: true, id: 'c-2' })
        case 'plane.readWorkItemCommentThread': {
          const answer = replies[Math.min(read, replies.length - 1)]
          read += 1
          if (!answer || answer.kind === 'hang') {
            return new Promise(() => {})
          }
          return reply(
            answer.kind === 'thread'
              ? { ok: true, comments: answer.comments }
              : { ok: false, error: answer.error }
          )
        }
        default:
          return new Promise(() => {})
      }
    })
  } as unknown as RpcClient
}

const MARKDOWN_COMMENT = {
  id: 'c-md',
  body: 'Fixed in **lab.49**, see [the PR](https://github.test/orca/pull/1).',
  createdAt: new Date().toISOString(),
  user: { id: 'u-2', displayName: 'Grace' }
}

function byLabel(label: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
}

function leafWithText(text: string): HTMLElement | null {
  for (const element of document.body.querySelectorAll<HTMLElement>('div')) {
    if (element.childElementCount === 0 && element.textContent === text) {
      return element
    }
  }
  return null
}

describe('Plane comment thread in the Tasks detail (react-native-web)', () => {
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
  })

  async function settle(): Promise<void> {
    for (let hop = 0; hop < 12; hop += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  async function openCard(
    capabilities: readonly string[],
    replies: ThreadReply[] = [{ kind: 'thread', comments: [] }]
  ): Promise<Call[]> {
    const calls: Call[] = []
    const client = createClient(capabilities, calls, replies)
    await act(async () => {
      root.render(
        createElement(PlaneTasksHarness, {
          client,
          initialProjectId: 'proj-1',
          initialQuery: '',
          listItems: [CARD as unknown as PlaneMobileWorkItem]
        })
      )
    })
    await settle()
    act(() => byLabel('Row Wire the retry')!.click())
    await settle()
    return calls
  }

  function threadReads(calls: Call[]): Call[] {
    return calls.filter((call) => call.method === 'plane.readWorkItemCommentThread')
  }

  it('shows the ticket body in the detail, not only its metadata', async () => {
    await openCard(READING_HOST)

    expect(leafWithText('Steps to reproduce, straight from the ticket body.')).not.toBeNull()
  })

  it('shows no comment area at all on a host that refuses the read', async () => {
    // Why: lab.54-55 advertise writes.v1 and still refuse the thread, so an empty
    // comment area there would read as "no comments" for a thread never read.
    const calls = await openCard(WRITING_HOST)

    expect(byLabel('Post comment')).not.toBeNull()
    expect(leafWithText('Comments')).toBeNull()
    expect(leafWithText('No comments yet.')).toBeNull()
    expect(threadReads(calls)).toHaveLength(0)
  })

  it('reads the open card thread and renders its comments', async () => {
    const calls = await openCard(READING_HOST, [{ kind: 'thread', comments: [COMMENT] }])

    expect(threadReads(calls)).toEqual([
      {
        method: 'plane.readWorkItemCommentThread',
        params: { projectId: 'proj-1', workItemId: 'wi-1', workspaceId: 'ws-1' }
      }
    ])
    expect(leafWithText('Reproduced on 0.0.47.')).not.toBeNull()
    expect(leafWithText('Ada')).not.toBeNull()
    expect(leafWithText('No comments yet.')).toBeNull()
  })

  it('renders a markdown comment formatted, with its link tappable', async () => {
    const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    await openCard(READING_HOST, [{ kind: 'thread', comments: [MARKDOWN_COMMENT] }])

    const thread = leafWithText('Grace')!.parentElement!.parentElement!
    expect(thread.textContent).toContain('Fixed in lab.49, see the PR.')
    expect(thread.textContent).not.toContain('**')
    expect(thread.textContent).not.toContain('](')
    const link = [...thread.querySelectorAll<HTMLElement>('span')].find(
      (node) => node.textContent === 'the PR'
    )
    expect(link).toBeDefined()
    act(() => link!.click())
    expect(openURL).toHaveBeenCalledWith('https://github.test/orca/pull/1')
    openURL.mockRestore()
  })

  it('says the thread is empty only after the host answered that it is', async () => {
    await openCard(READING_HOST, [{ kind: 'thread', comments: [] }])

    expect(leafWithText('No comments yet.')).not.toBeNull()
    expect(leafWithText('Could not read the comments')).toBeNull()
  })

  it('never says "no comments" while the read is still in flight', async () => {
    await openCard(READING_HOST, [{ kind: 'hang' }])

    expect(leafWithText('Loading comments…')).not.toBeNull()
    expect(leafWithText('No comments yet.')).toBeNull()
  })

  it('says the read failed instead of showing an empty thread, and retries on demand', async () => {
    // The control for ORCA-360: a failed read that renders as "no comments" tells
    // the PM the opposite of the truth.
    const calls = await openCard(READING_HOST, [
      { kind: 'failed', error: 'Unauthorized' },
      { kind: 'thread', comments: [COMMENT] }
    ])

    expect(leafWithText('Could not read the comments')).not.toBeNull()
    expect(leafWithText('No comments yet.')).toBeNull()
    expect(threadReads(calls)).toHaveLength(1)

    await act(async () => {
      byLabel('Retry comments')!.click()
      await Promise.resolve()
    })
    await settle()

    expect(threadReads(calls)).toHaveLength(2)
    expect(leafWithText('Reproduced on 0.0.47.')).not.toBeNull()
    expect(leafWithText('Could not read the comments')).toBeNull()
  })

  it('re-reads the thread after a post, so the comment shows in the thread it was written to', async () => {
    const calls = await openCard(READING_HOST, [
      { kind: 'thread', comments: [] },
      { kind: 'thread', comments: [COMMENT] }
    ])
    const input = document.body.querySelector('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    act(() => {
      setter!.call(input, 'Looks good')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      byLabel('Post comment')!.click()
      await Promise.resolve()
    })
    await settle()

    expect(threadReads(calls)).toHaveLength(2)
    expect(leafWithText('Reproduced on 0.0.47.')).not.toBeNull()
  })
})
