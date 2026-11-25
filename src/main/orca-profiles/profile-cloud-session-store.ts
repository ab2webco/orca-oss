import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { writeSecureJsonFile } from '../../shared/secure-file'
import { encryptSecretOffMainThread, LatestSecretWrites } from '../safe-storage-async-encrypt'
import type {
  OrcaCloudCapabilities,
  OrcaCloudOrgSummary,
  OrcaCloudSessionPersistence
} from '../../shared/orca-profiles'
import { getOrcaProfileDirectory } from './profile-storage-paths'
import { allowsPlaintextOrcaCloudSession } from './profile-cloud-auth-config'
import type { OrcaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import {
  cloudSessionIdentity,
  isCloudSessionMutationCurrent,
  recordSuccessfulCloudSessionLogin,
  type CloudSessionMutationSnapshot
} from './profile-cloud-session-mutation'

export type OrcaCloudSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  capabilities: OrcaCloudCapabilities
  organizations?: OrcaCloudOrgSummary[]
}

export type OrcaCloudSessionReadResult =
  | { status: 'found'; session: OrcaCloudSession; persistence: OrcaCloudSessionPersistence }
  | { status: 'missing'; persistence: 'none' }
  | { status: 'decrypt-failed'; persistence: 'none'; error: string }

type PersistedEncryptedSession = {
  version: 1
  format: 'electron-safe-storage-v1'
  savedAt: number
  ciphertext: string
}

type PersistedPlaintextSession = {
  version: 1
  format: 'dev-plaintext-v1'
  savedAt: number
  session: OrcaCloudSession
}

type CachedOrcaCloudSession = {
  session: OrcaCloudSession
  persistence: Exclude<OrcaCloudSessionPersistence, 'none'>
}

const memorySessions = new Map<string, CachedOrcaCloudSession>()
const pendingSessions = new Map<string, CachedOrcaCloudSession & { isCurrent: () => boolean }>()
const saveQueues = new Map<string, Promise<unknown>>()
const latestWrites = new LatestSecretWrites()

function sessionCacheKey(profileId: string, userDataPath: string): string {
  return `${userDataPath}\0${profileId}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOrcaCloudSession(value: unknown): value is OrcaCloudSession {
  if (!isObject(value) || !isObject(value.capabilities) || !isObject(value.capabilities.flags)) {
    return false
  }
  if (value.organizations !== undefined && !isOrcaCloudOrganizations(value.organizations)) {
    return false
  }
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.capabilities.refreshedAt === 'number' &&
    Number.isFinite(value.capabilities.refreshedAt)
  )
}

function isOrcaCloudOrganizations(value: unknown): value is OrcaCloudOrgSummary[] {
  if (!Array.isArray(value)) {
    return false
  }
  return value.every((organization) => {
    if (!isObject(organization)) {
      return false
    }
    return (
      typeof organization.orgId === 'string' &&
      organization.orgId.length > 0 &&
      typeof organization.name === 'string' &&
      organization.name.length > 0 &&
      (organization.role === undefined || typeof organization.role === 'string')
    )
  })
}

export function getOrcaCloudSessionPath(profileId: string, userDataPath: string): string {
  return join(getOrcaProfileDirectory(profileId, userDataPath), 'account-session.json.enc')
}

export async function saveOrcaCloudSession(
  profileId: string,
  userDataPath: string,
  session: OrcaCloudSession,
  isCurrent: () => boolean = () => true
): Promise<OrcaCloudSessionPersistence | null> {
  const cacheKey = sessionCacheKey(profileId, userDataPath)
  const isLatest = latestWrites.capture(cacheKey)
  // Why: a reader that merges and saves during this encrypt must build on this session and land
  // after it, or a rotated refresh token is rolled back. Saves run in order; a clear cancels them.
  const pending = {
    session,
    persistence: memorySessions.get(cacheKey)?.persistence ?? ('memory-only' as const),
    isCurrent: () => isLatest() && isCurrent()
  }
  pendingSessions.set(cacheKey, pending)
  const encrypting = (saveQueues.get(cacheKey) ?? Promise.resolve())
    .catch(() => null)
    .then(() => encryptSecretOffMainThread(JSON.stringify(session)))
  saveQueues.set(cacheKey, encrypting)
  let encrypted: Buffer | null
  try {
    encrypted = await encrypting
  } finally {
    if (pendingSessions.get(cacheKey) === pending) {
      pendingSessions.delete(cacheKey)
    }
  }
  // Why: checked in the write's own turn, so a refresh captured before sign-out/org-switch
  // or a save superseded during the encrypt cannot resurrect the session.
  if (!pending.isCurrent()) {
    return null
  }
  if (encrypted) {
    const persisted: PersistedEncryptedSession = {
      version: 1,
      format: 'electron-safe-storage-v1',
      savedAt: Date.now(),
      ciphertext: encrypted.toString('base64')
    }
    writeSecureJsonFile(getOrcaCloudSessionPath(profileId, userDataPath), persisted)
    memorySessions.set(cacheKey, { session, persistence: 'encrypted' })
    return 'encrypted'
  }
  if (allowsPlaintextOrcaCloudSession()) {
    const plaintext: PersistedPlaintextSession = {
      version: 1,
      format: 'dev-plaintext-v1',
      savedAt: Date.now(),
      session
    }
    writeSecureJsonFile(getOrcaCloudSessionPath(profileId, userDataPath), plaintext)
    memorySessions.set(cacheKey, { session, persistence: 'dev-plaintext' })
    return 'dev-plaintext'
  }

  // Why: Orca account refresh tokens must not silently fall back to plaintext
  // in production. Memory-only keeps cloud features usable until restart.
  memorySessions.set(cacheKey, { session, persistence: 'memory-only' })
  return 'memory-only'
}

export function saveOrcaCloudSessionExchange(
  profileId: string,
  userDataPath: string,
  exchange: OrcaCloudSessionExchangeResponse
): Promise<OrcaCloudSessionPersistence | null> {
  recordSuccessfulCloudSessionLogin(cloudSessionIdentity(profileId, exchange.cloud), userDataPath)
  return saveOrcaCloudSession(profileId, userDataPath, {
    accessToken: exchange.accessToken,
    refreshToken: exchange.refreshToken,
    expiresAt: exchange.expiresAt,
    organizations: exchange.organizations,
    capabilities: exchange.capabilities
  })
}

export function saveOrcaCloudSessionIfCurrent(
  profileId: string,
  userDataPath: string,
  session: OrcaCloudSession,
  snapshot: CloudSessionMutationSnapshot
): Promise<OrcaCloudSessionPersistence | null> {
  return saveOrcaCloudSession(profileId, userDataPath, session, () =>
    isCloudSessionMutationCurrent(profileId, userDataPath, snapshot)
  )
}

export function readOrcaCloudSession(
  profileId: string,
  userDataPath: string
): OrcaCloudSessionReadResult {
  const cacheKey = sessionCacheKey(profileId, userDataPath)
  const pending = pendingSessions.get(cacheKey)
  const memorySession = pending?.isCurrent() ? pending : memorySessions.get(cacheKey)
  if (memorySession) {
    return {
      status: 'found',
      session: memorySession.session,
      persistence: memorySession.persistence
    }
  }

  const path = getOrcaCloudSessionPath(profileId, userDataPath)
  if (!existsSync(path)) {
    return { status: 'missing', persistence: 'none' }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as
      | PersistedEncryptedSession
      | PersistedPlaintextSession
    if (parsed.version !== 1) {
      return { status: 'decrypt-failed', persistence: 'none', error: 'Unsupported session format.' }
    }
    if (parsed.format === 'electron-safe-storage-v1') {
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          status: 'decrypt-failed',
          persistence: 'none',
          error: 'OS-backed encryption is unavailable.'
        }
      }
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.ciphertext, 'base64'))
      const session = JSON.parse(decrypted) as OrcaCloudSession
      if (!isOrcaCloudSession(session)) {
        return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
      }
      memorySessions.set(cacheKey, { session, persistence: 'encrypted' })
      return { status: 'found', session, persistence: 'encrypted' }
    }
    if (parsed.format === 'dev-plaintext-v1' && allowsPlaintextOrcaCloudSession()) {
      if (!isOrcaCloudSession(parsed.session)) {
        return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
      }
      memorySessions.set(cacheKey, { session: parsed.session, persistence: 'dev-plaintext' })
      return { status: 'found', session: parsed.session, persistence: 'dev-plaintext' }
    }
    return { status: 'decrypt-failed', persistence: 'none', error: 'Unsafe session format.' }
  } catch {
    return {
      status: 'decrypt-failed',
      persistence: 'none',
      error: 'Could not decrypt saved Orca Lab account session.'
    }
  }
}

export function clearOrcaCloudSession(profileId: string, userDataPath: string): void {
  latestWrites.supersede(sessionCacheKey(profileId, userDataPath))
  memorySessions.delete(sessionCacheKey(profileId, userDataPath))
  rmSync(getOrcaCloudSessionPath(profileId, userDataPath), { force: true })
}
