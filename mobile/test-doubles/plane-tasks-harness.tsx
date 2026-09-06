// Render-test harness for the Plane surface of the Tasks screen: the screen's Plane
// wiring without the 15k-line screen around it. Shared by the *.render.test.tsx files.
import { act, createElement, useState, type ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import { Pressable, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { PlaneWorkItemFilter } from '../../src/shared/plane-types'
import type { RpcClient } from '../src/transport/rpc-client'
import { createPlaneTask } from '../src/tasks/plane-mobile-task-list'
import type { PlaneMobileWorkItem } from '../src/tasks/plane-mobile-work-item-read'
import { PlaneSourceSegmentRow } from '../src/plane-board/plane-source-segment-row'
import { PlaneTasksSurface } from '../src/plane-board/plane-tasks-surface'
import { usePlaneViewMode } from '../src/plane-board/plane-work-item-view'
import { useRuntimeCapabilities } from '../src/plane-board/use-runtime-capabilities'
import { deviceStorage } from './async-storage-memory'

export { deviceStorage }

export const PLANE_VIEW_STORAGE_KEY = 'orca:plane.work-item-view.v1'

export const PROJECT = { id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' }
export const OTHER_PROJECT = { id: 'proj-2', identifier: 'AB2', name: 'Ab2Web' }

export const CARD = {
  id: 'wi-1',
  identifier: 'ORCA-1',
  title: 'Wire the retry',
  url: '',
  project: PROJECT,
  state: { id: 'state-1', name: 'Todo', group: 'unstarted' },
  priority: 'none',
  updatedAt: ''
}

/** A card in the second column: the board shows both columns' cards at once. */
export const DOING_CARD = {
  ...CARD,
  id: 'wi-2',
  identifier: 'ORCA-2',
  title: 'Ship the shell',
  state: { id: 'state-2', name: 'Doing', group: 'started' }
}

export type Call = { method: string; params?: unknown }

export type HostBehaviour = {
  /** Every board write rejects with this error, the way a dropped socket or a timeout does. */
  rejectWrites?: Error
  /** Only writes on this card reject; the rest succeed. */
  rejectWritesFor?: string
  /** Writes on this card never answer, a request still inside its budget. */
  hangWritesFor?: string
  items?: readonly unknown[]
  /** What a re-read returns once a write was attempted: what Plane really holds. */
  itemsAfterWrite?: readonly unknown[]
  /** The board read (states + work items) never answers, so the board stays loading. */
  hangReads?: boolean
  /** The board read rejects, so the board settles in error. */
  failReads?: Error
}

export function createClient(
  capabilities: readonly string[],
  calls: Call[],
  behaviour: HostBehaviour = {}
): RpcClient {
  let writeAttempted = false
  return {
    sendRequest: async (method: string, params?: unknown) => {
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
      if (
        (method === 'plane.listStates' ||
          method === 'plane.listWorkItems' ||
          method === 'plane.searchWorkItems') &&
        (behaviour.hangReads || behaviour.failReads)
      ) {
        if (behaviour.hangReads) {
          return new Promise(() => {})
        }
        throw behaviour.failReads
      }
      switch (method) {
        case 'status.get':
          return reply({ hostPlatform: 'darwin', capabilities })
        case 'plane.listStates':
          return reply([
            { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
            { id: 'state-2', name: 'Doing', group: 'started', sequence: 2 }
          ])
        case 'plane.listWorkItems':
        case 'plane.searchWorkItems': {
          // Cards belong to the first project; the other project is empty.
          const projectId = (params as { projectId?: string } | undefined)?.projectId
          if (projectId === OTHER_PROJECT.id) {
            return reply([])
          }
          return reply((writeAttempted && behaviour.itemsAfterWrite) || behaviour.items || [])
        }
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
    }
  } as unknown as RpcClient
}

const safeAreaMetrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 }
}

type HarnessProps = {
  client: RpcClient
  initialProjectId: string | null
  initialQuery: string
  /** What the Tasks list would show as rows in list mode. */
  listItems: readonly PlaneMobileWorkItem[]
}

/** The segment row picks the view; list rows and board cards open the same detail.
 *  "Switch project" and "Close detail" stand in for the Tasks project picker and the
 *  sheet backdrop. */
export function PlaneTasksHarness({
  client,
  initialProjectId,
  initialQuery,
  listItems
}: HarnessProps): ReactElement {
  const capabilities = useRuntimeCapabilities(client, true)
  const [viewMode, setViewMode] = usePlaneViewMode()
  const [projectId, setProjectId] = useState(initialProjectId)
  const [filter, setFilter] = useState<PlaneWorkItemFilter>('all')
  const [query, setQuery] = useState(initialQuery)
  const [detail, setDetail] = useState<PlaneMobileWorkItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // A relay blip flips these false the way taskUiReady does; the surface's enabled follows.
  const [connected, setConnected] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  return createElement(
    SafeAreaProvider,
    { initialMetrics: safeAreaMetrics },
    createElement(
      View,
      null,
      createElement(PlaneSourceSegmentRow, {
        enabled: true,
        hasProject: projectId !== null,
        projectLabel: projectId === OTHER_PROJECT.id ? OTHER_PROJECT.name : 'Orca Lab',
        stateLabel: 'All states',
        filterLabel: 'All',
        viewMode,
        onSelectViewMode: setViewMode,
        onPickProject: () => setPickerOpen(true),
        onPickState: () => {},
        onPickFilter: () => {},
        buttonStyle: null,
        textStyle: null,
        selectedTextStyle: null
      }),
      viewMode === 'list'
        ? listItems.map((item) =>
            createElement(
              Pressable,
              {
                key: item.id,
                accessibilityRole: 'button',
                accessibilityLabel: `Row ${item.title}`,
                onPress: () => setDetail(item)
              },
              createElement(Text, null, item.title)
            )
          )
        : null,
      createElement(PlaneTasksSurface, {
        client,
        capabilities,
        enabled: connected,
        planeConnected: connected,
        viewMode,
        workspaceId: 'ws-1',
        projectId,
        projects: [PROJECT, OTHER_PROJECT],
        filter,
        query,
        detailItem: detail,
        onOpenCard: setDetail,
        onCloseDetail: () => setDetail(null),
        onCopyLink: (item: PlaneMobileWorkItem) => setCopiedKey(createPlaneTask(item).key),
        copied: detail !== null && copiedKey === createPlaneTask(detail).key,
        onPickProject: () => setPickerOpen(true),
        onClearFilter: () => {
          setFilter('all')
          setQuery('')
        },
        bottomInset: 0,
        menuButtonStyle: null,
        menuTextStyle: null
      }),
      pickerOpen ? createElement(Text, null, 'Project picker') : null,
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Switch project',
        onPress: () => setProjectId(projectId === PROJECT.id ? OTHER_PROJECT.id : PROJECT.id)
      }),
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Toggle connection',
        onPress: () => setConnected((value) => !value)
      }),
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Close detail',
        onPress: () => setDetail(null)
      })
    )
  )
}

export function byLabel(label: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
}

export function leafWithText(text: string, scope: ParentNode = document.body): HTMLElement | null {
  for (const element of scope.querySelectorAll<HTMLElement>('div')) {
    if (element.childElementCount === 0 && element.textContent === text) {
      return element
    }
  }
  return null
}

export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
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

/** The surface reads status.get, then states + items; each hop is a microtask boundary. */
export async function settle(): Promise<void> {
  for (let hop = 0; hop < 12; hop += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

export type MountOptions = {
  projectId?: string | null
  query?: string
}

export async function renderPlaneTasks(
  root: Root,
  capabilities: readonly string[],
  behaviour: HostBehaviour,
  options: MountOptions
): Promise<Call[]> {
  const calls: Call[] = []
  const client = createClient(capabilities, calls, behaviour)
  await act(async () => {
    root.render(
      createElement(PlaneTasksHarness, {
        client,
        initialProjectId: options.projectId === undefined ? 'proj-1' : options.projectId,
        initialQuery: options.query ?? '',
        listItems: (behaviour.items ?? []) as PlaneMobileWorkItem[]
      })
    )
  })
  await settle()
  return calls
}

/** Mounts with the board already chosen on this device, the way a second open looks. */
export async function mountBoard(
  root: Root,
  capabilities: readonly string[],
  behaviour: HostBehaviour = {},
  options: MountOptions = {}
): Promise<Call[]> {
  deviceStorage.entries.set(PLANE_VIEW_STORAGE_KEY, JSON.stringify({ viewMode: 'board' }))
  const calls = await renderPlaneTasks(root, capabilities, behaviour, options)
  if (options.projectId !== null && !calls.some((call) => call.method === 'plane.listStates')) {
    throw new Error('board did not finish loading')
  }
  return calls
}

export async function press(label: string): Promise<void> {
  const target = byLabel(label)
  if (!target) {
    throw new Error(`no control labelled ${label}`)
  }
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
  await settle()
}

export async function openCard(): Promise<void> {
  await press('Open Wire the retry')
}

/** Everything a board card says: title, its facts line and its state pill. */
export function cardText(title: string): string {
  const card = byLabel(`Open ${title}`)
  if (!card) {
    throw new Error(`no card titled ${title}`)
  }
  return card.textContent ?? ''
}

/** The shell's column header: the state name beside its card count. */
export function boardColumn(name: string): { count: number } | null {
  for (const leaf of document.body.querySelectorAll<HTMLElement>('div')) {
    if (leaf.childElementCount !== 0 || leaf.textContent !== name) {
      continue
    }
    const count = leaf.nextElementSibling?.textContent ?? ''
    if (/^\d+$/.test(count)) {
      return { count: Number(count) }
    }
  }
  return null
}

export function callsTo(calls: Call[], method: string): Call[] {
  return calls.filter((call) => call.method === method)
}

export function readsOf(calls: Call[]): number {
  return callsTo(calls, 'plane.listWorkItems').length
}
