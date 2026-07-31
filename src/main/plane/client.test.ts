import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD_FETCH = globalThis.fetch
const { closeAllConnectionsMock, netFetchMock, resolveProxyMock, setProxyMock } = vi.hoisted(
  () => ({
    closeAllConnectionsMock: vi.fn(),
    netFetchMock: vi.fn(),
    resolveProxyMock: vi.fn(),
    setProxyMock: vi.fn()
  })
)

type SafeStorageMockOptions = {
  encryptionAvailable?: boolean
  decryptString?: (value: Buffer) => string
}

let tempHome = ''

function mkdtempLike(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function tokenPath(workspaceId: string): string {
  return join(
    tempHome,
    '.orca',
    'plane-tokens',
    `${Buffer.from(workspaceId).toString('base64url')}.enc`
  )
}

function workspaceFilePath(): string {
  return join(tempHome, '.orca', 'plane-workspaces.json')
}

function expectedWorkspaceId(baseUrl: string, workspaceSlug: string): string {
  return createHash('sha256')
    .update(`${baseUrl}\n${workspaceSlug}`)
    .digest('base64url')
    .slice(0, 24)
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

const VIEWER_PAYLOAD = {
  id: 'user-1',
  email: 'viewer@example.com',
  display_name: 'Vic Viewer',
  avatar_url: 'https://example.com/avatar.png'
}

const EXPECTED_VIEWER = {
  id: 'user-1',
  displayName: 'Vic Viewer',
  email: 'viewer@example.com',
  avatarUrl: 'https://example.com/avatar.png'
}

function mockConnectSuccess(): void {
  netFetchMock
    .mockResolvedValueOnce(jsonResponse(VIEWER_PAYLOAD))
    .mockResolvedValueOnce(jsonResponse([]))
}

async function loadClientModule(options: SafeStorageMockOptions = {}) {
  vi.resetModules()
  vi.doMock('electron', () => ({
    net: { fetch: netFetchMock },
    safeStorage: {
      isEncryptionAvailable: () => options.encryptionAvailable ?? false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: options.decryptString ?? ((value: Buffer) => value.toString('utf-8'))
    },
    session: {
      defaultSession: {
        closeAllConnections: closeAllConnectionsMock,
        resolveProxy: resolveProxyMock,
        setProxy: setProxyMock
      }
    }
  }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })

  const client = await import('./client')
  const lifecycle = await import('./plane-connection-lifecycle')
  return { ...client, ...lifecycle }
}

beforeEach(() => {
  tempHome = mkdtempLike('orca-plane-client-')
  netFetchMock.mockReset()
  resolveProxyMock.mockReset()
  setProxyMock.mockReset()
  closeAllConnectionsMock.mockReset()
  resolveProxyMock.mockResolvedValue('DIRECT')
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch should not be called')
  }) as typeof fetch
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = OLD_FETCH
})

describe('normalizePlaneBaseUrl', () => {
  it('defaults to https://api.plane.so when empty', async () => {
    const { normalizePlaneBaseUrl } = await loadClientModule()
    expect(normalizePlaneBaseUrl('')).toBe('https://api.plane.so')
    expect(normalizePlaneBaseUrl('   ')).toBe('https://api.plane.so')
  })

  it('trims whitespace', async () => {
    const { normalizePlaneBaseUrl } = await loadClientModule()
    expect(normalizePlaneBaseUrl('  https://plane.example.com  ')).toBe('https://plane.example.com')
  })

  it('strips a trailing slash', async () => {
    const { normalizePlaneBaseUrl } = await loadClientModule()
    expect(normalizePlaneBaseUrl('https://plane.example.com/')).toBe('https://plane.example.com')
    expect(normalizePlaneBaseUrl('https://plane.example.com/api/')).toBe(
      'https://plane.example.com/api'
    )
  })

  it('strips query and hash', async () => {
    const { normalizePlaneBaseUrl } = await loadClientModule()
    expect(normalizePlaneBaseUrl('https://plane.example.com/api?x=1#frag')).toBe(
      'https://plane.example.com/api'
    )
  })
})

describe('connect', () => {
  it('maps the viewer, computes the workspace id, upserts, saves the token, and sets active', async () => {
    const { connect, status } = await loadClientModule({ encryptionAvailable: true })
    mockConnectSuccess()

    const result = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'secret-key'
    })

    expect(result).toEqual({ ok: true, viewer: EXPECTED_VIEWER })
    const expectedId = expectedWorkspaceId('https://api.plane.so', 'acme')
    expect(existsSync(workspaceFilePath())).toBe(true)
    expect(existsSync(tokenPath(expectedId))).toBe(true)

    const currentStatus = status()
    expect(currentStatus.connected).toBe(true)
    expect(currentStatus.activeWorkspaceId).toBe(expectedId)
    expect(currentStatus.workspaces).toEqual([
      { id: expectedId, baseUrl: 'https://api.plane.so', workspaceSlug: 'acme' }
    ])
    expect(currentStatus.viewer).toEqual(EXPECTED_VIEWER)
  })

  it('returns ok:false on a non-2xx users/me response', async () => {
    const { connect } = await loadClientModule()
    netFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid API key' }, 401))

    const result = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'bad-key'
    })

    expect(result).toEqual({ ok: false, error: 'Invalid API key' })
    // Membership check must not run once the key itself is rejected.
    expect(netFetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a clear error when the key is valid but lacks access to the workspace', async () => {
    const { connect } = await loadClientModule()
    netFetchMock
      .mockResolvedValueOnce(jsonResponse(VIEWER_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse({ error: 'Forbidden' }, 403))

    const result = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'valid-key'
    })

    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toContain('acme')
    expect((result as { ok: false; error: string }).error.toLowerCase()).toContain('access')
  })

  it('allows the SAME key to be reused with a different workspace slug (no rejection)', async () => {
    const { connect, status } = await loadClientModule()
    mockConnectSuccess()
    const first = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'shared-key'
    })
    expect(first.ok).toBe(true)

    mockConnectSuccess()
    const second = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'beta',
      apiKey: 'shared-key'
    })
    expect(second.ok).toBe(true)

    const currentStatus = status()
    expect(currentStatus.workspaces).toHaveLength(2)
    expect(currentStatus.workspaces?.map((workspace) => workspace.workspaceSlug).sort()).toEqual([
      'acme',
      'beta'
    ])
  })

  it('updates the existing row (no duplicate) when the same (baseUrl, slug) reconnects with a rotated key', async () => {
    const { connect, getClients, status } = await loadClientModule()
    mockConnectSuccess()
    await connect({ baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', apiKey: 'old-key' })

    mockConnectSuccess()
    const result = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'new-key'
    })

    expect(result.ok).toBe(true)
    const currentStatus = status()
    expect(currentStatus.workspaces).toHaveLength(1)
    const clients = getClients('all')
    expect(clients).toHaveLength(1)
    expect(clients[0]?.headers['x-api-key']).toBe('new-key')
  })
})

describe('isAuthError', () => {
  it('is true only for a 401 PlaneApiError', async () => {
    const { PlaneApiError, isAuthError } = await loadClientModule()
    expect(isAuthError(new PlaneApiError('unauthorized', 401))).toBe(true)
    expect(isAuthError(new PlaneApiError('forbidden', 403))).toBe(false)
    expect(isAuthError(new Error('unauthorized'))).toBe(false)
  })
})

describe('clearWorkspaceTokenOnAuthError', () => {
  it('deletes the saved token on a 401, so the workspace drops out of status()', async () => {
    const { connect, status, getClients, PlaneApiError, clearWorkspaceTokenOnAuthError } =
      await loadClientModule()
    mockConnectSuccess()
    await connect({ baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', apiKey: 'secret-key' })
    expect(status().connected).toBe(true)
    const [connectedClient] = getClients('all')

    clearWorkspaceTokenOnAuthError(connectedClient!, new PlaneApiError('Unauthorized', 401))

    expect(status().connected).toBe(false)
  })

  it('leaves the token intact for a non-401 error (e.g. 403 workspace-membership gap)', async () => {
    const { connect, status, getClients, PlaneApiError, clearWorkspaceTokenOnAuthError } =
      await loadClientModule()
    mockConnectSuccess()
    await connect({ baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', apiKey: 'secret-key' })
    const [connectedClient] = getClients('all')

    clearWorkspaceTokenOnAuthError(connectedClient!, new PlaneApiError('Forbidden', 403))

    expect(status().connected).toBe(true)
  })
})

describe('credential storage', () => {
  it('falls back to plaintext with exactly one console.warn when safeStorage is unavailable', async () => {
    const { connect } = await loadClientModule({ encryptionAvailable: false })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockConnectSuccess()

    const result = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'plain-key'
    })

    expect(result.ok).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const expectedId = expectedWorkspaceId('https://api.plane.so', 'acme')
    expect(readFileSync(tokenPath(expectedId), 'utf-8')).toBe('plain-key')
  })
})

describe('connection lifecycle: disconnect/select/status/testConnection', () => {
  it('supports select, test, and disconnect across multiple workspaces', async () => {
    const { connect, disconnect, selectWorkspace, status, testConnection } =
      await loadClientModule()
    mockConnectSuccess()
    await connect({ baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', apiKey: 'key-acme' })
    mockConnectSuccess()
    await connect({ baseUrl: 'https://api.plane.so', workspaceSlug: 'beta', apiKey: 'key-beta' })

    const acmeId = expectedWorkspaceId('https://api.plane.so', 'acme')
    const betaId = expectedWorkspaceId('https://api.plane.so', 'beta')

    const selected = selectWorkspace({ workspaceId: betaId })
    expect(selected.selectedWorkspaceId).toBe(betaId)
    expect(selected.activeWorkspaceId).toBe(betaId)

    mockConnectSuccess()
    const testResult = await testConnection({ workspaceId: acmeId })
    expect(testResult).toEqual({ ok: true, viewer: EXPECTED_VIEWER })

    disconnect({ workspaceId: acmeId })
    expect(status().workspaces?.map((workspace) => workspace.id)).toEqual([betaId])
    expect(existsSync(tokenPath(acmeId))).toBe(false)

    disconnect()
    expect(status().connected).toBe(false)
    expect(existsSync(tokenPath(betaId))).toBe(false)
  })

  it('testConnection reports not connected when no workspace is saved', async () => {
    const { testConnection } = await loadClientModule()
    const result = await testConnection()
    expect(result).toEqual({ ok: false, error: 'Not connected to Plane.' })
    expect(netFetchMock).not.toHaveBeenCalled()
  })
})

describe('429 handling', () => {
  it('retries once honoring Retry-After, then surfaces the error on a second failure', async () => {
    const { connect } = await loadClientModule()
    netFetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '0.01' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Still rate limited' }, 429))

    const result = await connect({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'acme',
      apiKey: 'secret-key'
    })

    expect(result).toEqual({ ok: false, error: 'Still rate limited' })
    // Exactly one retry: the original users/me call plus one bounded retry.
    expect(netFetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('planeFetch (exported transport)', () => {
  it('forwards the raw init — including the abort signal — without Plane auth headers', async () => {
    const { planeFetch } = await loadClientModule()
    netFetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const controller = new AbortController()

    const response = await planeFetch('https://storage.example.com/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=b' },
      body: new Uint8Array([1, 2, 3]),
      signal: controller.signal
    })

    expect(response.status).toBe(204)
    const [url, init] = netFetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://storage.example.com/uploads')
    expect(init.method).toBe('POST')
    expect(init.signal).toBe(controller.signal)
    // The presigned storage POST authenticates via the signed form fields; an
    // x-api-key header here would leak the Plane credential to storage.
    expect(new Headers(init.headers).has('x-api-key')).toBe(false)
  })
})

// ORCA-140: Plane's 400 on an invalid project name carries the reason in a
// DRF field-error body; collapsing that to the status line left the caller with
// nothing to act on.
describe('readPlaneError', () => {
  it('relays a DRF field error from the response body', async () => {
    const { readPlaneError } = await loadClientModule()

    const message = await readPlaneError(
      jsonResponse({ name: ['Special characters are not allowed.'] }, 400)
    )

    expect(message).toBe('name: Special characters are not allowed.')
  })

  it('falls back to the status line only when the body says nothing', async () => {
    const { readPlaneError } = await loadClientModule()

    expect(await readPlaneError(new Response('', { status: 400 }))).toBe(
      'Plane request failed (400)'
    )
    expect(await readPlaneError(jsonResponse({}, 400))).toBe('Plane request failed (400)')
  })
})
