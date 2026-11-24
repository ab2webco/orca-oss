// Encrypted API-key storage for Plane workspaces. Split out of
// plane-workspace-store.ts to keep each file under the oxlint max-lines cap
// without a suppression. Mirrors jira/client.ts's token-file pattern.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readIntegrationCredentialFileSync,
  readStoredCredentialTokenAsync
} from '../integration-credential-file'
import { PendingCredentialReads } from '../integration-credential-pending-reads'
import {
  assertIntegrationCredentialBytes,
  assertIntegrationStringBytes,
  IntegrationAccountPersistenceLimitError,
  MAX_INTEGRATION_ACCOUNT_FILE_BYTES,
  MAX_INTEGRATION_ACCOUNT_ID_BYTES,
  MAX_INTEGRATION_ACCOUNTS
} from '../integration-account-persistence-limits'

const cachedTokens = new Map<string, string>()
// Why: decrypt failures are recorded per workspace so status() can explain
// failing reads without re-touching the keychain on every status poll.
const credentialErrors = new Map<string, string>()
const pendingReads = new PendingCredentialReads<string>('Plane')

function cacheToken(workspaceId: string, apiKey: string): void {
  if (!cachedTokens.has(workspaceId) && cachedTokens.size >= MAX_INTEGRATION_ACCOUNTS) {
    const oldestId = cachedTokens.keys().next().value
    if (oldestId !== undefined) {
      cachedTokens.delete(oldestId)
    }
  }
  cachedTokens.set(workspaceId, apiKey)
}

function getTokenDir(): string {
  return join(homedir(), '.orca', 'plane-tokens')
}

function getTokenPath(workspaceId: string): string {
  assertIntegrationStringBytes(
    'Plane',
    'workspace ID',
    workspaceId,
    MAX_INTEGRATION_ACCOUNT_ID_BYTES
  )
  return join(getTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.enc`)
}

function ensureTokenDir(): void {
  const dir = getTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function hasStoredWorkspaceToken(workspaceId: string): boolean {
  return cachedTokens.has(workspaceId) || credentialFileHasContent(getTokenPath(workspaceId))
}

function writeEncryptedToken(path: string, apiKey: string): void {
  assertIntegrationCredentialBytes('Plane', apiKey)
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(apiKey)
    if (encrypted.length > MAX_INTEGRATION_ACCOUNT_FILE_BYTES) {
      throw new IntegrationAccountPersistenceLimitError(
        `Plane encrypted credential exceeds ${MAX_INTEGRATION_ACCOUNT_FILE_BYTES} bytes.`
      )
    }
    writeFileSync(path, encrypted, { mode: 0o600 })
    return
  }
  console.warn('[plane] safeStorage encryption unavailable — storing token in plaintext')
  writeFileSync(path, apiKey, { encoding: 'utf-8', mode: 0o600 })
}

export async function readWorkspaceToken(workspaceId: string): Promise<string | null> {
  const cached = cachedTokens.get(workspaceId)
  if (cached !== undefined) {
    return cached
  }
  const path = getTokenPath(workspaceId)
  if (!existsSync(path)) {
    return null
  }
  return pendingReads.read(workspaceId, {
    load: async () => {
      const token = await readStoredCredentialTokenAsync(
        'Plane',
        readIntegrationCredentialFileSync(path)
      )
      if (token) {
        assertIntegrationCredentialBytes('Plane', token)
      }
      return token
    },
    commit: (token) => {
      if (token) {
        cacheToken(workspaceId, token)
      }
      credentialErrors.delete(workspaceId)
    },
    fail: (error) => {
      if (
        error instanceof CredentialDecryptionError ||
        error instanceof IntegrationAccountPersistenceLimitError
      ) {
        credentialErrors.set(workspaceId, error.message)
        throw error
      }
      return null
    },
    latest: () => cachedTokens.get(workspaceId) ?? null
  })
}

export function saveWorkspaceToken(workspaceId: string, apiKey: string): void {
  ensureTokenDir()
  writeEncryptedToken(getTokenPath(workspaceId), apiKey)
  pendingReads.forget(workspaceId)
  cacheToken(workspaceId, apiKey)
  credentialErrors.delete(workspaceId)
}

export function deleteWorkspaceToken(workspaceId: string): void {
  pendingReads.forget(workspaceId)
  cachedTokens.delete(workspaceId)
  credentialErrors.delete(workspaceId)
  try {
    unlinkSync(getTokenPath(workspaceId))
  } catch {
    // Token may not exist — safe to ignore.
  }
}

export function getWorkspaceCredentialError(workspaceId: string): string | undefined {
  return credentialErrors.get(workspaceId)
}
