import {
  findUnknownOrcaEventNames,
  ORCA_EVENT_NAMES,
  type OrcaEvent
} from '../../shared/orca-events'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { RuntimeRpcFailureError } from '../runtime/types'
import { getOptionalWorktreeSelector } from '../selectors'

type EventsFrame =
  | { type: 'ready'; subscriptionId: string }
  | { type: 'event'; event: OrcaEvent }
  | { type: 'dropped'; count: number }
  | { type: 'end' }

function eventNamesFrom(flags: Map<string, string | boolean>): string[] {
  const names = getRepeatedStringFlag(flags, 'event')
    .flatMap((value) => value.split(','))
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  const unknown = findUnknownOrcaEventNames(names)
  if (unknown.length > 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Unknown event ${unknown.join(', ')}. Use one of: ${ORCA_EVENT_NAMES.join(', ')}, or a family like agent.*`
    )
  }
  return names
}

function describeEvent(event: OrcaEvent): string {
  switch (event.name) {
    case 'agent.status.changed': {
      const { state, agentType, interrupted, sessionBoundary } = event.payload
      const detail = interrupted ? ' interrupted' : sessionBoundary ? ' session-start' : ''
      return `${state}${detail}${agentType ? ` (${agentType})` : ''}`
    }
    case 'terminal.created':
    case 'terminal.closed':
      return event.payload.title
    case 'terminal.title.changed':
      return `${event.payload.previousTitle} -> ${event.payload.title}`
    case 'worktree.created':
      return `${event.payload.branch} ${event.payload.path}`
    case 'worktree.removed':
      return event.payload.path
    case 'notification.dispatched':
      return `${event.payload.title}: ${event.payload.body}`
  }
}

function formatEventLine(event: OrcaEvent): string {
  const time = new Date(event.at).toISOString().slice(11, 19)
  const where = event.terminal ?? event.worktreeId ?? '-'
  return `${time} ${event.name} ${where} ${describeEvent(event)}`
}

function printFrame(frame: EventsFrame, json: boolean): void {
  if (frame.type === 'event') {
    console.log(json ? JSON.stringify(frame.event) : formatEventLine(frame.event))
  } else if (frame.type === 'ready') {
    console.log(
      json ? JSON.stringify({ ready: true }) : 'Listening for Orca Lab events (Ctrl-C to stop)'
    )
  } else if (frame.type === 'dropped') {
    console.log(
      json
        ? JSON.stringify({ dropped: frame.count })
        : `${frame.count} events dropped: this reader fell behind`
    )
  }
}

export const EVENTS_HANDLERS: Record<string, CommandHandler> = {
  events: async ({ flags, client, cwd, json }) => {
    const names = eventNamesFrom(flags)
    if (client.isRemote) {
      throw new RuntimeClientError(
        'invalid_argument',
        '`orca events` streams from the Orca Lab app on this machine; paired remote hosts are not supported yet.'
      )
    }
    const worktree = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
    const terminal = getOptionalStringFlag(flags, 'terminal')
    try {
      await client.stream(
        'events.subscribe',
        {
          names,
          ...(worktree !== undefined ? { worktree } : {}),
          ...(terminal !== undefined ? { terminal } : {})
        },
        (frame) => printFrame(frame as EventsFrame, json)
      )
    } catch (error) {
      if (error instanceof RuntimeRpcFailureError && error.code === 'method_not_found') {
        throw new RuntimeClientError(
          'method_not_found',
          'This Orca Lab version cannot stream events. Update Orca Lab and run `orca events` again.'
        )
      }
      throw error
    }
  }
}
