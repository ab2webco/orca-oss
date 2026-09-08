// Render-test harness for the Plane surface of the Tasks screen: the screen's Plane
// wiring without the 15k-line screen around it. Shared by the *.render.test.tsx files.
import {
  act,
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type { Root } from 'react-dom/client'
import { Pressable, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { PlaneWorkItemFilter } from '../../src/shared/plane-types'
import {
  DEFAULT_PLANE_WORK_ITEM_FILTER,
  PLANE_WORK_ITEM_FILTER_LABELS
} from '../../src/shared/plane-work-item-filter-labels'
import type { RpcClient } from '../src/transport/rpc-client'
import { createPlaneTask } from '../src/tasks/plane-mobile-task-list'
import type { ProviderTaskOrderBy } from '../src/tasks/linear-mobile-issue-grouping'
import {
  DEFAULT_PLANE_TASK_DISPLAY_PROPERTIES,
  toggleTaskDisplayProperty,
  type PlaneTaskDisplayProperty
} from '../src/tasks/provider-task-display-properties'
import type { PlaneTaskGroupBy } from '../src/tasks/provider-task-view-options'
import { planeListSections } from '../src/tasks/plane-list-sections'
import { fetchPlaneWorkItems } from '../src/tasks/plane-mobile-task-source'
import type {
  PlaneMobileState,
  PlaneMobileWorkItem
} from '../src/tasks/plane-mobile-work-item-read'
import { PlaneSourceSegmentRow } from '../src/plane-board/plane-source-segment-row'
import { resolvePlaneTasksChrome } from '../src/plane-board/plane-tasks-chrome-visibility'
import { PlaneTasksSurface } from '../src/plane-board/plane-tasks-surface'
import { PLANE_VIEW_MODES, usePlaneViewMode } from '../src/plane-board/plane-work-item-view'
import { useRuntimeCapabilities } from '../src/plane-board/use-runtime-capabilities'
import { deviceStorage } from './async-storage-memory'
import { settle } from './plane-tasks-screen-driver'

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
  /** The board's own read — the state metadata — never answers, so its columns stay
   *  whatever the cards derive. The list's rows are unaffected. */
  hangReads?: boolean
  /** That same read rejects, so the board settles in error. */
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
      if (method === 'plane.listStates' && (behaviour.hangReads || behaviour.failReads)) {
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
  /** The screen's planeStates[0]; null while a project change has emptied it (ORCA-463). */
  defaultState: PlaneMobileState | null
}

/** The segment row picks the view; list rows and board cards open the same detail.
 *  "Switch project" and "Close detail" stand in for the Tasks project picker and the
 *  sheet backdrop. */
export function PlaneTasksHarness({
  client,
  initialProjectId,
  initialQuery,
  defaultState
}: HarnessProps): ReactElement {
  const capabilities = useRuntimeCapabilities(client, true)
  const [viewMode, setViewMode] = usePlaneViewMode()
  const [projectId, setProjectId] = useState(initialProjectId)
  const [filter, setFilter] = useState<PlaneWorkItemFilter>(DEFAULT_PLANE_WORK_ITEM_FILTER)
  const [query, setQuery] = useState(initialQuery)
  const [detail, setDetail] = useState<PlaneMobileWorkItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [viewPickerOpen, setViewPickerOpen] = useState(false)
  // The Tasks screen owns these; so does this stand-in, which is the point of ORCA-418.
  const [groupBy, setGroupBy] = useState<PlaneTaskGroupBy>('none')
  const [orderBy, setOrderBy] = useState<ProviderTaskOrderBy>('priority')
  const [displayProperties, setDisplayProperties] = useState<ReadonlySet<PlaneTaskDisplayProperty>>(
    () => new Set(DEFAULT_PLANE_TASK_DISPLAY_PROPERTIES)
  )
  // A relay blip flips this false. It gates Plane's data only: the screen's `enabled` never
  // carried the connection, so the surface keeps its chrome and the open sheet (ORCA-419).
  const [connected, setConnected] = useState(true)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // The Tasks screen owns the one read both views project from; so does this stand-in.
  const [listItems, setListItems] = useState<readonly PlaneMobileWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const loadedRef = useRef<PlaneMobileWorkItem[]>([])
  // The screen's own answer to which Plane UI is on screen.
  const chrome = resolvePlaneTasksChrome({
    provider: 'plane',
    planeSupported: true,
    taskUiReady: true,
    viewMode
  })
  const load = useCallback(
    async (silent: boolean): Promise<PlaneMobileWorkItem[] | null> => {
      if (!connected) {
        setLoading(false)
        return null
      }
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      try {
        const rows = await fetchPlaneWorkItems(client, {
          query,
          filter,
          projectId,
          workspaceId: 'ws-1'
        })
        loadedRef.current = rows
        setListItems(rows)
        return rows
      } catch {
        loadedRef.current = []
        setListItems([])
        return null
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [client, connected, filter, projectId, query]
  )
  useEffect(() => {
    void load(false)
  }, [load])
  const refreshItems = useCallback(() => load(true), [load])
  return createElement(
    SafeAreaProvider,
    { initialMetrics: safeAreaMetrics },
    createElement(
      View,
      null,
      chrome.segmentRowShown
        ? createElement(PlaneSourceSegmentRow, {
            enabled: true,
            hasProject: projectId !== null,
            projectLabel: projectId === OTHER_PROJECT.id ? OTHER_PROJECT.name : 'Orca Lab',
            stateLabel: 'All states',
            filterLabel: PLANE_WORK_ITEM_FILTER_LABELS[filter],
            viewMode,
            onPickViewMode: () => setViewPickerOpen(true),
            groupBy,
            orderBy,
            onChangeGroupBy: setGroupBy,
            onChangeOrderBy: setOrderBy,
            displayProperties,
            onToggleDisplayProperty: (property: PlaneTaskDisplayProperty) =>
              setDisplayProperties((current) => toggleTaskDisplayProperty(current, property)),
            onPickProject: () => setPickerOpen(true),
            onPickState: () => {},
            onPickFilter: () => {},
            buttonStyle: null,
            textStyle: null
          })
        : null,
      // The screen runs its list rows through planeListSections; so does this stand-in,
      // which is what makes Group and Order real in list mode (ORCA-418).
      !chrome.boardShown
        ? planeListSections(listItems.map(createPlaneTask), groupBy, orderBy).flatMap((section) => [
            ...(section.label
              ? [
                  createElement(
                    Text,
                    { key: `section:${section.key}`, accessibilityLabel: `Group ${section.label}` },
                    section.label
                  )
                ]
              : []),
            ...section.items.map((row) =>
              createElement(
                Pressable,
                {
                  key: row.source.id,
                  accessibilityRole: 'button',
                  accessibilityLabel: `Row ${row.source.title}`,
                  onPress: () => setDetail(row.source)
                },
                createElement(Text, null, row.source.title)
              )
            )
          ])
        : null,
      createElement(PlaneTasksSurface, {
        client,
        capabilities,
        enabled: chrome.surfaceEnabled,
        planeConnected: connected,
        viewMode,
        groupBy,
        orderBy,
        displayProperties,
        workspaceId: 'ws-1',
        projectId,
        projects: [PROJECT, OTHER_PROJECT],
        filter,
        query,
        workItems: listItems,
        itemsLoading: loading,
        itemsRefreshing: refreshing,
        onRefreshItems: refreshItems,
        detailItem: detail,
        onOpenCard: setDetail,
        onCloseDetail: () => setDetail(null),
        onCopyLink: (item: PlaneMobileWorkItem) => setCopiedKey(createPlaneTask(item).key),
        copied: detail !== null && copiedKey === createPlaneTask(detail).key,
        onPickProject: () => setPickerOpen(true),
        onClearFilter: () => {
          setFilter(DEFAULT_PLANE_WORK_ITEM_FILTER)
          setQuery('')
        },
        bottomInset: 0,
        createOpen,
        onCloseCreate: () => setCreateOpen(false),
        projectLabel: projectId === OTHER_PROJECT.id ? OTHER_PROJECT.name : 'Orca Lab',
        defaultState
      }),
      pickerOpen ? createElement(Text, null, 'Project picker') : null,
      // The screen opens a PickerModal here; the stand-in offers the same two choices.
      viewPickerOpen
        ? PLANE_VIEW_MODES.map((mode) =>
            createElement(Pressable, {
              key: mode,
              accessibilityRole: 'button',
              accessibilityLabel: `Show as ${mode}`,
              onPress: () => {
                setViewMode(mode)
                setViewPickerOpen(false)
              }
            })
          )
        : null,
      // The screen's header `+`: the sheet cannot create without a project, so it opens the picker then.
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'New work item',
        onPress: () => (projectId === null ? setPickerOpen(true) : setCreateOpen(true))
      }),
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Switch project',
        onPress: () => setProjectId(projectId === PROJECT.id ? OTHER_PROJECT.id : PROJECT.id)
      }),
      // The screen re-reads without clearing its rows whenever the filter, the project or
      // the query changes; this is that non-silent reload, on demand.
      createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Reload rows',
        onPress: () => {
          void load(false)
        }
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

export type MountOptions = {
  projectId?: string | null
  query?: string
  defaultState?: PlaneMobileState | null
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
        defaultState: options.defaultState === undefined ? CARD.state : options.defaultState
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

export function callsTo(calls: Call[], method: string): Call[] {
  return calls.filter((call) => call.method === method)
}

export function readsOf(calls: Call[]): number {
  return callsTo(calls, 'plane.listWorkItems').length
}
