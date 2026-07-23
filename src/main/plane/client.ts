// Plane connect + credentials (plane-task-provider Slice 3). Persistence
// lives in plane-workspace-store.ts; status/disconnect/select/testConnection
// live in plane-connection-lifecycle.ts (kept under the oxlint max-lines cap
// without a suppression). This module owns network plumbing, the two-header
// auth contract, and connect().
import { net, session } from 'electron'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan } from '../observability/tracer'
import { readFetchResponseJsonWithinLimit } from '../lib/fetch-response-body'
import { IntegrationApiConcurrencyGate } from '../integration-api-concurrency'
import {
  assertIntegrationCredentialBytes,
  assertIntegrationStringBytes,
  MAX_INTEGRATION_ACCOUNT_LABEL_BYTES,
  MAX_INTEGRATION_ACCOUNT_URL_BYTES
} from '../integration-account-persistence-limits'
import { boundedIntegrationErrorMessage } from '../integration-error-message'
import { PlaneRateLimiter, parsePlaneRetryAfterMs } from './plane-rate-limiter'
import {
  assertWorkspaceFileBounds,
  getPlaneWorkspaceId,
  getWorkspaceFile,
  getWorkspaceFileReadError,
  saveWorkspaceToken,
  setCachedViewer,
  writeWorkspaceFile,
  type PlaneWorkspaceFile
} from './plane-workspace-store'
import type { PlaneConnectArgs, PlaneViewer, PlaneWorkspace } from '../../shared/plane-types'

// Re-exported: getClients() resolves saved workspaces into usable clients,
// the natural "creds" counterpart to connect() that plane-connection-lifecycle.ts
// and future work-item slices also depend on.
export { getClients } from './plane-workspace-store'

const MAX_CONCURRENT = 4
const concurrencyGate = new IntegrationApiConcurrencyGate(MAX_CONCURRENT)
const rateLimiter = new PlaneRateLimiter()
// Bounded 429 fallback when the response carries no usable Retry-After.
const DEFAULT_RETRY_DELAY_MS = 1000
// Exported: plane-connection-lifecycle.ts's testConnection() hits the same path.
export const USERS_ME_PATH = '/api/v1/users/me/'

export function acquire(): Promise<void> {
  return concurrencyGate.acquire()
}

export function release(): void {
  concurrencyGate.release()
}

export type PlaneClientForWorkspace = {
  baseUrl: string
  workspaceSlug: string
  headers: { 'x-api-key': string; 'x-workspace-slug': string }
}

export class PlaneApiError extends Error {
  status: number | null

  constructor(message: string, status: number | null = null) {
    super(boundedIntegrationErrorMessage(message))
    this.status = status
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizePlaneBaseUrl(input: string): string {
  const trimmed = input.trim()
  const base = trimmed.length > 0 ? trimmed : 'https://api.plane.so'
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(base) ? base : `https://${base}`
  const url = new URL(withProtocol)
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

// Exported: reused by plane-connection-lifecycle.ts's testConnection(), which
// re-runs the same users/me + membership pair against a saved workspace.
export function workspaceMembershipPath(workspaceSlug: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/projects/`
}

export function noWorkspaceAccessError(workspaceSlug: string): string {
  return `Your Plane API key does not have access to the "${workspaceSlug}" workspace.`
}

export function toViewer(data: Record<string, unknown>): PlaneViewer {
  const firstName = typeof data.first_name === 'string' ? data.first_name : ''
  const lastName = typeof data.last_name === 'string' ? data.last_name : ''
  const fullName = `${firstName} ${lastName}`.trim()
  const email = typeof data.email === 'string' ? data.email : null
  const displayName =
    (typeof data.display_name === 'string' && data.display_name ? data.display_name : '') ||
    fullName ||
    email ||
    'Plane user'
  return {
    id: typeof data.id === 'string' ? data.id : '',
    displayName,
    email,
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : undefined
  }
}

function describeErrorCause(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return undefined
  }
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    return boundedIntegrationErrorMessage(`${cause.name}: ${cause.message}`)
  }
  return cause === undefined ? undefined : boundedIntegrationErrorMessage(cause)
}

async function planeFetch(url: string, init: RequestInit): Promise<Response> {
  return withSpan(
    'plane.request',
    async (span) => {
      span.setAttribute('plane.baseUrl', new URL(url).origin)
      await ensureElectronProxyFromEnvironment({
        proxySession: session.defaultSession,
        probeUrl: url
      }).catch((error) => {
        span.addEvent('plane.proxySetupFailed', {
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: boundedIntegrationErrorMessage(error)
        })
      })
      try {
        // Why: Electron's network stack follows Chromium proxy/session state,
        // avoiding undici's stale keep-alive sockets after VPN path changes.
        return await net.fetch(url, init)
      } catch (error) {
        span.setAttribute(
          'plane.transportErrorName',
          error instanceof Error ? error.name : typeof error
        )
        span.setAttribute('plane.transportErrorMessage', boundedIntegrationErrorMessage(error))
        const cause = describeErrorCause(error)
        if (cause) {
          span.setAttribute('plane.transportErrorCause', cause)
        }
        throw error
      }
    },
    { kind: 'client' }
  )
}

// Bounded single retry on 429, honoring Retry-After. If the retry also fails
// the caller sees that second response (and throws) — no unbounded looping.
async function planeFetchWithRetry(
  rateLimiterKey: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  await rateLimiter.acquire(rateLimiterKey)
  const response = await planeFetch(url, init)
  if (response.status !== 429) {
    return response
  }
  const retryAfterMs =
    parsePlaneRetryAfterMs(response.headers.get('retry-after')) ?? DEFAULT_RETRY_DELAY_MS
  await sleep(retryAfterMs)
  await rateLimiter.acquire(rateLimiterKey)
  return planeFetch(url, init)
}

export async function readPlaneError(response: Response): Promise<string> {
  try {
    const data = await readFetchResponseJsonWithinLimit<{
      error?: string
      detail?: string
      message?: string
    }>(response)
    const message = data.error || data.detail || data.message
    if (message) {
      return message
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Plane request failed (${response.status})`
}

function planeHeaders(apiKey: string, workspaceSlug: string, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json')
  headers.set('x-api-key', apiKey)
  headers.set('x-workspace-slug', workspaceSlug)
  return headers
}

// Raw (un-parsed, non-throwing) request used before a workspace is saved,
// e.g. during connect() where 401/403 on the membership check must be
// distinguished from a generic transport/parse failure.
async function rawWorkspaceRequest(
  baseUrl: string,
  workspaceSlug: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const headers = planeHeaders(apiKey, workspaceSlug, init)
  const rateLimiterKey = `${baseUrl}\n${workspaceSlug}`
  return planeFetchWithRetry(rateLimiterKey, `${baseUrl}${path}`, { ...init, headers })
}

// Exported: plane-connection-lifecycle.ts's testConnection() reuses this
// non-throwing primitive to distinguish 401/403 from other failure shapes.
export async function rawClientRequest(
  client: PlaneClientForWorkspace,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return rawWorkspaceRequest(
    client.baseUrl,
    client.workspaceSlug,
    client.headers['x-api-key'],
    path,
    init
  )
}

export async function planeRequest<T>(
  client: PlaneClientForWorkspace,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await rawClientRequest(client, path, init)
  if (!response.ok) {
    throw new PlaneApiError(await readPlaneError(response), response.status)
  }
  if (response.status === 204) {
    return null as T
  }
  return readFetchResponseJsonWithinLimit<T>(response)
}

export async function connect(
  args: PlaneConnectArgs
): Promise<{ ok: true; viewer: PlaneViewer } | { ok: false; error: string }> {
  try {
    assertIntegrationStringBytes(
      'Plane',
      'base URL',
      args.baseUrl,
      MAX_INTEGRATION_ACCOUNT_URL_BYTES
    )
    assertIntegrationStringBytes(
      'Plane',
      'workspace slug',
      args.workspaceSlug,
      MAX_INTEGRATION_ACCOUNT_LABEL_BYTES
    )
    assertIntegrationCredentialBytes('Plane', args.apiKey)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? boundedIntegrationErrorMessage(error) : 'Connection failed.'
    }
  }

  const baseUrl = normalizePlaneBaseUrl(args.baseUrl)
  const workspaceSlug = args.workspaceSlug.trim()
  const apiKey = args.apiKey.trim()
  if (!workspaceSlug || !apiKey) {
    return { ok: false, error: 'Workspace slug and API key are required.' }
  }

  getWorkspaceFile()
  const readError = getWorkspaceFileReadError()
  if (readError) {
    return { ok: false, error: readError.message }
  }

  await acquire()
  try {
    const meResponse = await rawWorkspaceRequest(baseUrl, workspaceSlug, apiKey, USERS_ME_PATH)
    if (!meResponse.ok) {
      return { ok: false, error: await readPlaneError(meResponse) }
    }
    const viewer = toViewer(
      await readFetchResponseJsonWithinLimit<Record<string, unknown>>(meResponse)
    )

    // Key valid, but membership within THIS workspace slug is unverified until
    // a workspace-scoped endpoint succeeds (see Slice 3 spec correction: a PAT
    // is account-level and may be valid yet lack access to a given workspace).
    const membershipResponse = await rawWorkspaceRequest(
      baseUrl,
      workspaceSlug,
      apiKey,
      workspaceMembershipPath(workspaceSlug)
    )
    if (!membershipResponse.ok) {
      if (membershipResponse.status === 401 || membershipResponse.status === 403) {
        return { ok: false, error: noWorkspaceAccessError(workspaceSlug) }
      }
      return { ok: false, error: await readPlaneError(membershipResponse) }
    }

    // Identity = (baseUrl, workspaceSlug), never the API key: reconnecting the
    // same slug with a rotated key updates this row; the same key reused with
    // a different slug is a second, independent row (never rejected).
    const id = getPlaneWorkspaceId(baseUrl, workspaceSlug)
    const workspace: PlaneWorkspace = { id, baseUrl, workspaceSlug }
    const file = getWorkspaceFile()
    const nextFile: PlaneWorkspaceFile = {
      version: 1,
      activeWorkspaceId: id,
      selectedWorkspaceId: id,
      workspaces: [workspace, ...file.workspaces.filter((entry) => entry.id !== id)]
    }
    assertWorkspaceFileBounds(nextFile)
    saveWorkspaceToken(id, apiKey)
    writeWorkspaceFile(nextFile)
    setCachedViewer(id, viewer)
    return { ok: true, viewer }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? boundedIntegrationErrorMessage(error) : 'Connection failed.'
    }
  } finally {
    release()
  }
}

export function isAuthError(error: unknown): boolean {
  // Why: Plane returns 403 for workspace-membership gaps even when a PAT is
  // otherwise valid, so only 401 means the saved credential itself is bad.
  return error instanceof PlaneApiError && error.status === 401
}
