// The host behind the Plane render tests: fixtures and the RPC double the harness mounts.
import type { RpcClient } from '../src/transport/rpc-client'

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

const STATES = [
  { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
  { id: 'state-2', name: 'Doing', group: 'started', sequence: 2 }
]

const WRITE_METHODS = new Set([
  'plane.createWorkItem',
  'plane.updateWorkItem',
  'plane.addWorkItemComment',
  'plane.updateState'
])

export type Call = { method: string; params?: unknown }

export type HostBehaviour = {
  /** Every board write rejects with this error, the way a dropped socket or a timeout does. */
  rejectWrites?: Error
  /** Only writes on this card or column reject; the rest succeed. */
  rejectWritesFor?: string
  /** Writes on this card never answer, a request still inside its budget. */
  hangWritesFor?: string
  items?: readonly unknown[]
  /** What a re-read returns once a write was attempted: what Plane really holds. */
  itemsAfterWrite?: readonly unknown[]
  /** What plane.listStates returns once a write was attempted: the columns Plane really holds. */
  statesAfterWrite?: readonly unknown[]
  /** The board's own read — the state metadata — never answers, so its columns stay
   *  whatever the cards derive. The list's rows are unaffected. */
  hangReads?: boolean
  /** That same read rejects, so the board settles in error. */
  failReads?: Error
  /** The re-read after a write rejects: the write landed, the board cannot show it. */
  failReadsAfterWrite?: Error
  /** What plane.listMembers answers; Ada and Grace when omitted. */
  members?: readonly unknown[]
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
      if (WRITE_METHODS.has(method)) {
        writeAttempted = true
        const { workItemId, stateId } = params as { workItemId?: string; stateId?: string }
        const target = workItemId ?? stateId
        if (behaviour.hangWritesFor && target === behaviour.hangWritesFor) {
          return new Promise(() => {})
        }
        if (
          behaviour.rejectWrites &&
          (!behaviour.rejectWritesFor || target === behaviour.rejectWritesFor)
        ) {
          throw behaviour.rejectWrites
        }
      }
      if (method === 'plane.listStates' && writeAttempted && behaviour.failReadsAfterWrite) {
        throw behaviour.failReadsAfterWrite
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
          return reply((writeAttempted && behaviour.statesAfterWrite) || STATES)
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
        case 'plane.updateState': {
          const { stateId, name } = params as { stateId: string; name?: string }
          const state = STATES.find((known) => known.id === stateId)
          return reply({ ok: true, state: { ...state, id: stateId, name: name ?? state?.name } })
        }
        case 'plane.listMembers':
          return reply(
            behaviour.members ?? [
              { id: 'u-1', displayName: 'Ada' },
              { id: 'u-2', displayName: 'Grace' }
            ]
          )
        default:
          return new Promise(() => {})
      }
    }
  } as unknown as RpcClient
}
