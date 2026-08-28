import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  describeBlockedRequest,
  isLoopbackRequest,
  requestUrlOf
} from './vitest-non-loopback-fetch-guard'

describe('isLoopbackRequest', () => {
  it('allows the local servers suites start for themselves', () => {
    for (const url of [
      'http://127.0.0.1:55053/hook/codex',
      'http://localhost:3000/x',
      'http://[::1]:8080/',
      'https://127.0.0.1/orca/web-index.html'
    ]) {
      expect(isLoopbackRequest(url), url).toBe(true)
    }
  })

  it('blocks a real host, including the one that leaked a token', () => {
    for (const url of [
      'https://chatgpt.com/backend-api/wham/usage',
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
      'https://api.github.com/repos',
      'http://169.254.169.254/latest/meta-data/'
    ]) {
      expect(isLoopbackRequest(url), url).toBe(false)
    }
  })

  it('does not block non-network schemes or relative fixtures', () => {
    expect(isLoopbackRequest('data:text/plain,hi')).toBe(true)
    expect(isLoopbackRequest('/api/local-fixture')).toBe(true)
  })

  it('is not fooled by a real host that merely mentions localhost', () => {
    expect(isLoopbackRequest('https://localhost.evil.example/steal')).toBe(false)
    expect(isLoopbackRequest('https://example.com/?host=127.0.0.1')).toBe(false)
  })
})

describe('requestUrlOf', () => {
  it('reads the url from a string, a URL and a Request-like', () => {
    expect(requestUrlOf('https://example.com/a')).toBe('https://example.com/a')
    expect(requestUrlOf(new URL('https://example.com/b'))).toBe('https://example.com/b')
    expect(requestUrlOf({ url: 'https://example.com/c' })).toBe('https://example.com/c')
  })
})

describe('describeBlockedRequest', () => {
  it('names the url and the test so the failure is actionable', () => {
    const message = describeBlockedRequest('https://chatgpt.com/x', 'some test')
    expect(message).toContain('https://chatgpt.com/x')
    expect(message).toContain('some test')
  })
})

// The tests above only exercise the predicate. A predicate that answers
// correctly while the installed wrapper ignores it protects nobody — which is
// the exact shape of the bug this guard exists to prevent, where six tests
// passed while the code reached the network. These go through the real
// setupFiles-installed global.
describe('the installed guard', () => {
  let server: Server
  let loopbackUrl = ''

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('loopback-ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) {
      throw new Error('loopback server did not bind a port')
    }
    loopbackUrl = `http://127.0.0.1:${address.port}/probe`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('rejects a real host through the global fetch this suite actually runs with', async () => {
    await expect(fetch('https://chatgpt.com/backend-api/wham/usage')).rejects.toThrow(
      'Unit tests must not reach a non-loopback host: https://chatgpt.com/backend-api/wham/usage'
    )
  })

  it('names the test in the rejection so the failure is actionable', async () => {
    await expect(fetch('https://api.github.com/repos')).rejects.toThrow(
      'names the test in the rejection'
    )
  })

  it('still delivers a loopback request to a server the test started', async () => {
    const response = await fetch(loopbackUrl)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('loopback-ok')
  })
})
