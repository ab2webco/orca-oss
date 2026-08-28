import { beforeEach, expect } from 'vitest'

// Why this runs for every unit test: two rate-limit suites read the developer's
// real CODEX_HOME/auth.json and sent that access token to chatgpt.com. CI has no
// auth.json, so CI stayed green and only developers were affected — and six of
// the ten tests reached the network while still passing, so no survey of
// failures could find the class (ORCA-312, ORCA-319). Loopback stays allowed:
// plenty of suites stand up a local server on 127.0.0.1 and fetch from it.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

export function isLoopbackRequest(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // A relative URL cannot leave the machine from Node, and jsdom-style
    // suites use them for fixtures.
    return true
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'file:') {
    return true
  }
  return LOOPBACK_HOSTNAMES.has(parsed.hostname)
}

export function requestUrlOf(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  const candidate = (input as { url?: unknown } | null)?.url
  return typeof candidate === 'string' ? candidate : String(input)
}

export function describeBlockedRequest(url: string, testName: string | undefined): string {
  return (
    `Unit tests must not reach a non-loopback host: ${url}\n` +
    `  test: ${testName ?? '<unknown>'}\n` +
    '  A test that reaches the real network reads whatever credentials the machine\n' +
    "  has and passes or fails on someone else's live state (ORCA-312). Mock the\n" +
    '  client, or point it at a server the test itself starts on 127.0.0.1.'
  )
}

const realFetch = globalThis.fetch

// Assigned rather than vi.stubGlobal'd: a shared afterEach calling
// unstubAllGlobals would also drop stubs the test file installed for itself.
// A test's own vi.stubGlobal('fetch', ...) still overrides this for its
// duration, and unstubbing restores the guard rather than the real fetch.
beforeEach(() => {
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = requestUrlOf(input)
    if (isLoopbackRequest(url)) {
      return (realFetch as (i: unknown, n?: unknown) => Promise<Response>)(input, init)
    }
    // Rejecting rather than throwing: callers await this, and a synchronous
    // throw would surface as a different failure inside their own try/catch.
    return Promise.reject(new Error(describeBlockedRequest(url, expect.getState().currentTestName)))
  }) as typeof globalThis.fetch
})
