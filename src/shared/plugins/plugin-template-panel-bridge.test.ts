import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

type MessageListener = (event: { data: unknown }) => void

// Callable, infinitely chainable stand-in for any DOM node; only writes are recorded.
function makeNode(writes: string[], clicks: Map<string, () => void>, id = ''): unknown {
  const store: Record<string | symbol, unknown> = {}
  const node: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop in store) {
        return store[prop]
      }
      if (prop === 'addEventListener') {
        return (type: string, listener: () => void) => {
          if (type === 'click') {
            clicks.set(id, listener)
          }
        }
      }
      if (prop === 'value' || prop === 'textContent') {
        return ''
      }
      if (prop === Symbol.iterator || prop === 'then') {
        return undefined
      }
      return makeNode(writes, clicks)
    },
    set(_target, prop, value) {
      store[prop] = value
      writes.push(String(value))
      return true
    },
    apply() {
      return makeNode(writes, clicks)
    }
  })
  return node
}

function loadPanel(plugin: string): {
  deliver: MessageListener
  posted: { requestId: string }[]
  clicks: Map<string, () => void>
  writes: string[]
} {
  const html = readFileSync(
    join(process.cwd(), 'examples', 'plugins', plugin, 'panel.html'),
    'utf8'
  )
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] ?? ''
  const writes: string[] = []
  const clicks = new Map<string, () => void>()
  const posted: { requestId: string }[] = []
  let deliver: MessageListener = () => {
    throw new Error('panel registered no message listener')
  }
  const window = {
    addEventListener: (type: string, listener: MessageListener) => {
      if (type === 'message') {
        deliver = listener
      }
    },
    parent: { postMessage: (message: { requestId: string }) => posted.push(message) }
  }
  const document = {
    getElementById: (id: string) => makeNode(writes, clicks, id),
    createElement: () => makeNode(writes, clicks),
    querySelector: () => makeNode(writes, clicks),
    querySelectorAll: () => []
  }
  runInNewContext(script, { window, document, setTimeout, clearTimeout, Promise, Date, Error })
  return { deliver: (event) => deliver(event), posted, clicks, writes }
}

describe.each([
  { plugin: 'hello-orca', trigger: 'ctx' },
  { plugin: 'worklog', trigger: undefined }
])('$plugin panel bridge', ({ plugin, trigger }) => {
  it('ignores replies whose requestId names an Object.prototype member', () => {
    const panel = loadPanel(plugin)
    for (const requestId of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
      expect(() =>
        panel.deliver({ data: { type: 'orca-panel-action-result', requestId, ok: true } })
      ).not.toThrow()
    }
  })

  it('still settles the requests its replies answer', async () => {
    const panel = loadPanel(plugin)
    if (trigger) {
      panel.clicks.get(trigger)?.()
    }
    expect(panel.posted.length).toBeGreaterThan(0)
    for (const { requestId } of panel.posted) {
      panel.deliver({
        data: { type: 'orca-panel-action-result', requestId, ok: false, error: 'reply-marker' }
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel.writes.some((text) => text.includes('reply-marker'))).toBe(true)
  })
})
