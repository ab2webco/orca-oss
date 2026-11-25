import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { safeStorage } from 'electron'
import {
  readNodeFileSyncWithinLimit,
  readNodeFileWithinLimit
} from '../shared/node-bounded-file-reader'
import {
  credentialDecryptionMessage,
  type IntegrationCredentialService
} from '../shared/integration-credential-errors'
import { encryptSecretOffMainThread } from './safe-storage-async-encrypt'

export const MAX_INTEGRATION_CREDENTIAL_FILE_BYTES = 1024 * 1024

export function readIntegrationCredentialFileSync(filePath: string): Buffer {
  return readNodeFileSyncWithinLimit(filePath, MAX_INTEGRATION_CREDENTIAL_FILE_BYTES).buffer
}

export function readIntegrationCredentialFileSyncText(filePath: string): string {
  return readIntegrationCredentialFileSync(filePath).toString('utf8')
}

export async function readIntegrationCredentialFileText(filePath: string): Promise<string> {
  return (
    await readNodeFileWithinLimit(filePath, MAX_INTEGRATION_CREDENTIAL_FILE_BYTES)
  ).buffer.toString('utf8')
}

// Why: connection status treats a token file as a saved credential; empty
// files read as "missing", so counting them would split-brain getStatus.
export function credentialFileHasContent(path: string): boolean {
  try {
    return statSync(path).size > 0
  } catch {
    return false
  }
}

// Why: a disconnect mid-encrypt must fail the connect, not list an account with no token.
export class CredentialSaveSupersededError extends Error {
  constructor() {
    super('Disconnected before the token was saved.')
  }
}

// Falls back to plaintext bytes when the OS keyring is unavailable, matching the
// Linear/Jira token writers so a keyring-less box still connects.
export async function encryptCredentialForFile(
  service: IntegrationCredentialService,
  value: string
): Promise<Buffer> {
  const encrypted = await encryptSecretOffMainThread(value)
  if (encrypted) {
    return encrypted
  }
  console.warn(
    `[${service.toLowerCase()}] safeStorage encryption unavailable — storing credential in plaintext`
  )
  return Buffer.from(value, 'utf-8')
}

// Why (STA-3941): a direct write can truncate the previous credential if it
// fails or the app dies mid-write, leaving nothing to authenticate with. Write
// a sibling temp file, fsync it, then rename — readers only ever observe the
// old bytes or the complete new ones.
export function writeCredentialFileAtomic(path: string, data: Buffer): void {
  const tempPath = `${path}.tmp`
  let handle: number | null = null
  try {
    handle = openSync(tempPath, 'w', 0o600)
    // Why: write(2) is allowed to return a short count, so a single writeSync
    // could publish a truncated credential — the very corruption this avoids.
    let written = 0
    while (written < data.length) {
      const bytes = writeSync(handle, data, written, data.length - written)
      if (bytes <= 0) {
        throw new Error(`Credential write stalled at ${written}/${data.length} bytes`)
      }
      written += bytes
    }
    fsyncSync(handle)
    closeSync(handle)
    handle = null
    renameSync(tempPath, path)
    restrictCredentialFileToOwner(path)
  } catch (error) {
    if (handle !== null) {
      try {
        closeSync(handle)
      } catch {
        // Already closed or invalid; the unlink below is what matters.
      }
    }
    try {
      unlinkSync(tempPath)
    } catch {
      // Nothing to clean up.
    }
    throw error
  }
}

// Why: writeFileSync's `mode` only applies when it creates the file, so
// rewriting an existing credential would silently keep looser permissions.
// Best-effort: Windows has no POSIX modes, so chmod is a documented no-op there.
export function restrictCredentialFileToOwner(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best-effort hardening; the write itself already succeeded.
  }
}

export class CredentialDecryptionError extends Error {
  constructor(service: IntegrationCredentialService) {
    super(credentialDecryptionMessage(service))
    this.name = 'CredentialDecryptionError'
  }
}

// Returns the stored token, null when the file is empty, and throws
// CredentialDecryptionError when the file holds ciphertext we cannot decrypt
// (e.g. the user denied the OS keychain prompt after an app re-sign).
export function readStoredCredentialToken(
  service: IntegrationCredentialService,
  raw: Buffer
): string | null {
  if (raw.length === 0) {
    return null
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return usableToken(safeStorage.decryptString(raw))
    } catch {
      return readPlaintextLegacyCredential(service, raw)
    }
  }

  return readPlaintextLegacyCredential(service, raw)
}

// Why: an unanswered Keychain prompt must fail the call, not hold it until the CLI times out.
export const CREDENTIAL_KEYCHAIN_WAIT_MS = 10_000

export class CredentialKeychainWaitError extends Error {
  constructor(service: IntegrationCredentialService) {
    super(
      `Orca is waiting for Keychain access to read the saved ${service} credential. Answer the system prompt, then try again.`
    )
    this.name = 'CredentialKeychainWaitError'
  }
}

export async function boundCredentialKeychainWait<T>(
  service: IntegrationCredentialService,
  read: Promise<T>,
  timeoutMs = CREDENTIAL_KEYCHAIN_WAIT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CredentialKeychainWaitError(service)), timeoutMs)
  })
  try {
    return await Promise.race([read, wait])
  } finally {
    clearTimeout(timer)
  }
}

export const ASYNC_DECRYPT_UNAVAILABLE = Symbol('async-decrypt-unavailable')
export const ASYNC_DECRYPT_FAILED = Symbol('async-decrypt-failed')

// Why (ORCA-1298): decryptString and, on macOS, isEncryptionAvailable read the
// Keychain on the main thread, so one unanswered access prompt froze every IPC
// and CLI call. The async API reads it on a background thread.
export async function readStoredCredentialTokenAsync(
  service: IntegrationCredentialService,
  raw: Buffer
): Promise<string | null> {
  if (raw.length === 0) {
    return null
  }
  const decrypted = await decryptOffMainThread(raw)
  if (decrypted === ASYNC_DECRYPT_UNAVAILABLE || decrypted === ASYNC_DECRYPT_FAILED) {
    // Why: on macOS the sync path would read the Keychain on the main thread, unbounded;
    // Linux without a keyring and Windows keep today's sync reading.
    return process.platform === 'darwin'
      ? readPlaintextLegacyCredential(service, raw)
      : readStoredCredentialToken(service, raw)
  }
  return usableToken(decrypted)
}

export async function decryptOffMainThread(
  raw: Buffer
): Promise<string | typeof ASYNC_DECRYPT_UNAVAILABLE | typeof ASYNC_DECRYPT_FAILED> {
  if (
    typeof safeStorage.decryptStringAsync !== 'function' ||
    typeof safeStorage.isAsyncEncryptionAvailable !== 'function' ||
    !(await safeStorage.isAsyncEncryptionAvailable().catch(() => false))
  ) {
    return ASYNC_DECRYPT_UNAVAILABLE
  }
  try {
    return (await safeStorage.decryptStringAsync(raw)).result
  } catch {
    return ASYNC_DECRYPT_FAILED
  }
}

function readPlaintextLegacyCredential(
  service: IntegrationCredentialService,
  raw: Buffer
): string | null {
  const plaintext = decodeUtf8(raw)
  // Why: legacy plaintext tokens are printable UTF-8; safeStorage ciphertext
  // such as macOS v10 blobs must not be decoded into auth-header junk.
  if (plaintext === null || hasControlCharacter(plaintext)) {
    throw new CredentialDecryptionError(service)
  }
  return usableToken(plaintext)
}

function usableToken(token: string): string | null {
  return token.length > 0 ? token : null
}

function decodeUtf8(raw: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return null
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}
