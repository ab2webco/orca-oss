import type { WebSocket } from 'ws'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'
import {
  createMockTerminals,
  FAKE_SCROLLBACK,
  STREAMING_CHUNKS
} from './mock-server-terminal-fixtures'
import { isShowcaseScenario } from './mock-server-showcase-scenario'
import { showcaseTerminalScript } from './mock-server-showcase-terminal'

// One output timeline per terminal, like a PTY: a resubscribe (the client does one on every
// viewport change) gets everything written so far as scrollback, then the live tail.
type TerminalTimeline = {
  written: string
  queue: string[]
  interval: ReturnType<typeof setInterval> | null
  subscribers: Set<Subscriber>
}
type Subscriber = { ws: WebSocket; emit: (chunk: string) => void }
const timelines = new Map<string, TerminalTimeline>()
const subscriptions = new WeakMap<WebSocket, Map<string, Subscriber>>()
const CHUNK_INTERVAL_MS = Number(process.env.MOCK_CHUNK_INTERVAL_MS) || 500

const toCrlf = (text: string) => text.replace(/\r?\n/g, '\r\n')

function timelineOf(terminal: string): TerminalTimeline {
  let timeline = timelines.get(terminal)
  if (!timeline) {
    const script = isShowcaseScenario
      ? showcaseTerminalScript(terminal)
      : { scrollback: FAKE_SCROLLBACK, chunks: STREAMING_CHUNKS }
    timeline = {
      written: toCrlf(script.scrollback),
      queue: [...script.chunks],
      interval: null,
      subscribers: new Set()
    }
    timelines.set(terminal, timeline)
    drainQueue(timeline)
  }
  return timeline
}

function write(timeline: TerminalTimeline, chunk: string): void {
  timeline.written += chunk
  for (const subscriber of timeline.subscribers) {
    // A closed socket never unsubscribes, so it is pruned here.
    if (subscriber.ws.readyState !== subscriber.ws.OPEN) {
      timeline.subscribers.delete(subscriber)
      continue
    }
    subscriber.emit(chunk)
  }
}

function drainQueue(timeline: TerminalTimeline): void {
  if (timeline.interval !== null) {
    return
  }
  timeline.interval = setInterval(() => {
    const chunk = timeline.queue.shift()
    if (chunk === undefined) {
      // Why: no `end` event - a live terminal stream stays open, and `end`
      // makes the client tear the subscription down and blank the pane.
      clearInterval(timeline.interval!)
      timeline.interval = null
      return
    }
    write(timeline, toCrlf(chunk))
  }, CHUNK_INTERVAL_MS)
}

function unsubscribe(ws: WebSocket, terminal: string): void {
  const subscriber = subscriptions.get(ws)?.get(terminal)
  if (subscriber) {
    timelines.get(terminal)?.subscribers.delete(subscriber)
    subscriptions.get(ws)?.delete(terminal)
  }
}

/** Paced output on `terminal`, as if its agent printed it. */
export function queueTerminalOutput(terminal: string, chunks: readonly string[]): void {
  const timeline = timelineOf(terminal)
  timeline.queue.push(...chunks)
  drainQueue(timeline)
}

function echoTerminalInput(terminal: string, text: string, enter: boolean): void {
  const echo = text.replace(/\r/g, '').replace(/\x7f/g, '\b \b')
  if (echo) {
    write(timelineOf(terminal), echo)
  }
  if (enter || text.includes('\r')) {
    queueTerminalOutput(terminal, ['\n', ...showcaseTerminalScript(terminal).reply])
  }
}

/** Terminal list/stream/input backend for the mock server. Returns false for
 *  methods it does not own. */
export function handleMockTerminalRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown, streaming?: boolean) => RpcResponse,
  ws: WebSocket,
  // Shared with `session.tabs.list` so both surfaces agree on which worktree an
  // absent or `id:`-prefixed selector means.
  resolveWorktreeId: (selector: unknown) => string | undefined
): boolean {
  switch (request.method) {
    case 'terminal.list': {
      const terminals = createMockTerminals(resolveWorktreeId(request.params?.worktree))
      respond(
        success(request.id, {
          terminals,
          totalCount: terminals.length,
          truncated: false
        })
      )
      return true
    }

    case 'terminal.subscribe': {
      const terminal = String(request.params?.terminal ?? 'term-1')
      unsubscribe(ws, terminal)
      const timeline = timelineOf(terminal)
      let perSocket = subscriptions.get(ws)
      if (!perSocket) {
        perSocket = new Map()
        subscriptions.set(ws, perSocket)
      }
      // Why the gate: a delayed frame (MOCK_RPC_DELAY_*) must not land after a resubscribe or unsubscribe.
      const isCurrent = () => perSocket.get(terminal) === subscriber && ws.readyState === ws.OPEN
      const subscriber: Subscriber = {
        ws,
        emit: (chunk) => respond(success(request.id, { type: 'data', chunk }, true), isCurrent)
      }
      // Why: the client resubscribes until scrollback echoes its viewport dims;
      // the legacy `lines` shape left the session screen in that loop forever.
      const viewport = request.params?.viewport as { cols?: number; rows?: number } | undefined
      // MOCK_TUI=1 arms SGR drag mouse tracking (1002/1006) inside the scrollback
      // itself so every xterm re-init re-enters the mode - used by mouse/touch
      // input repros (#8818).
      const tuiPreamble =
        process.env.MOCK_TUI === '1'
          ? '\x1b[?1002h\x1b[?1006h[mock] mouse tracking ON (1002/1006)\r\n'
          : ''
      respond(
        success(request.id, {
          type: 'scrollback',
          cols: viewport?.cols ?? 80,
          rows: viewport?.rows ?? 24,
          serialized: timeline.written + tuiPreamble,
          truncated: false
        }),
        isCurrent
      )
      perSocket.set(terminal, subscriber)
      timeline.subscribers.add(subscriber)
      return true
    }

    case 'terminal.send': {
      // Input-routing repros (#8818) assert on the exact bytes reaching the host.
      console.log(
        `[SEND] terminal=${String(request.params?.terminal)} text=${JSON.stringify(request.params?.text)}`
      )
      if (isShowcaseScenario) {
        echoTerminalInput(
          String(request.params?.terminal),
          String(request.params?.text ?? ''),
          request.params?.enter === true
        )
      }
      respond(success(request.id, { send: { handle: 'term-1', ok: true } }))
      return true
    }

    case 'terminal.unsubscribe':
      unsubscribe(ws, String(request.params?.terminal ?? 'term-1'))
      respond(success(request.id, { unsubscribed: true }))
      return true

    default:
      return false
  }
}
