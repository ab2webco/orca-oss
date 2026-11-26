import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { safeStorageMock } = vi.hoisted(() => ({
  safeStorageMock: {
    isEncryptionAvailable: vi.fn(),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isAsyncEncryptionAvailable: vi.fn(),
    decryptStringAsync: vi.fn()
  }
}))

const KEYCHAIN_WAIT_MS = 10_000
// Ciphertext-like bytes: the plaintext-legacy fallback rejects them, as it does real v10 blobs.
const CIPHERTEXT_A = Buffer.from([0x76, 0x31, 0x30, 0x01, 0x02, 0x41])
const CIPHERTEXT_B = Buffer.from([0x76, 0x31, 0x30, 0x01, 0x02, 0x42])

let tempHome = ''

function writeTokenFile(workspaceId: string, bytes: Buffer): void {
  const dir = join(tempHome, '.orca', 'plane-tokens')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${Buffer.from(workspaceId).toString('base64url')}.enc`), bytes)
}

function writeWorkspaceFile(ids: string[]): void {
  writeFileSync(
    join(tempHome, '.orca', 'plane-workspaces.json'),
    JSON.stringify({
      version: 1,
      activeWorkspaceId: ids[0],
      selectedWorkspaceId: 'all',
      workspaces: ids.map((id) => ({ id, baseUrl: 'https://plane.example.com', workspaceSlug: id }))
    })
  )
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function loadStore() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  const store = await import('./plane-workspace-store')
  // Why: the wrapper lets each test assert behaviour, not the sync-vs-async shape.
  const read = async (workspaceId: string): Promise<string | null> =>
    store.readWorkspaceToken(workspaceId)
  return { ...store, read }
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

const ORIGINAL_PLATFORM = process.platform

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-token-'))
  for (const fn of Object.values(safeStorageMock)) {
    fn.mockReset()
  }
  // Why: on macOS both sync calls read the Keychain on the main thread, which is the freeze under test.
  safeStorageMock.isEncryptionAvailable.mockImplementation(() => {
    throw new Error('sync Keychain read on the main thread')
  })
  safeStorageMock.decryptString.mockImplementation(() => {
    throw new Error('sync Keychain read on the main thread')
  })
  safeStorageMock.isAsyncEncryptionAvailable.mockResolvedValue(true)
  setPlatform('darwin')
})

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM)
  vi.useRealTimers()
})

describe('readWorkspaceToken', () => {
  it('decrypts with the async API and never touches the sync Keychain read', async () => {
    writeTokenFile('ws-a', CIPHERTEXT_A)
    safeStorageMock.decryptStringAsync.mockResolvedValue({
      result: 'token-a',
      shouldReEncrypt: false
    })
    const { read } = await loadStore()

    await expect(read('ws-a')).resolves.toBe('token-a')
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
    expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it('fails an unanswered Keychain prompt after the bound, then serves the token once it is answered', async () => {
    vi.useFakeTimers()
    writeTokenFile('ws-a', CIPHERTEXT_A)
    const prompt = deferred<{ result: string; shouldReEncrypt: boolean }>()
    safeStorageMock.decryptStringAsync.mockReturnValue(prompt.promise)
    const { read } = await loadStore()

    const waiting = read('ws-a')
    const outcome = expect(waiting).rejects.toThrow('waiting for Keychain access')
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await outcome

    prompt.resolve({ result: 'token-a', shouldReEncrypt: false })
    await vi.advanceTimersByTimeAsync(0)
    await expect(read('ws-a')).resolves.toBe('token-a')
    expect(safeStorageMock.decryptStringAsync).toHaveBeenCalledTimes(1)
  })

  it('shares one Keychain request between concurrent reads', async () => {
    writeTokenFile('ws-a', CIPHERTEXT_A)
    const prompt = deferred<{ result: string; shouldReEncrypt: boolean }>()
    safeStorageMock.decryptStringAsync.mockReturnValue(prompt.promise)
    const { read } = await loadStore()

    const reads = Promise.all([read('ws-a'), read('ws-a')])
    prompt.resolve({ result: 'token-a', shouldReEncrypt: false })

    await expect(reads).resolves.toEqual(['token-a', 'token-a'])
    expect(safeStorageMock.decryptStringAsync).toHaveBeenCalledTimes(1)
  })

  it('keeps a token saved while the prompt is open over the late read', async () => {
    writeTokenFile('ws-a', CIPHERTEXT_A)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const prompt = deferred<{ result: string; shouldReEncrypt: boolean }>()
    safeStorageMock.decryptStringAsync.mockReturnValue(prompt.promise)
    const { read, saveWorkspaceToken } = await loadStore()

    const stale = read('ws-a')
    await saveWorkspaceToken('ws-a', 'token-new')
    prompt.resolve({ result: 'token-old', shouldReEncrypt: false })

    await expect(stale).resolves.toBe('token-new')
    await expect(read('ws-a')).resolves.toBe('token-new')
  })

  it('on macOS reports a failed async decrypt as the decrypt error without a sync retry', async () => {
    writeTokenFile('ws-a', CIPHERTEXT_A)
    safeStorageMock.decryptStringAsync.mockRejectedValue(new Error('temporarily unavailable'))
    const { read, getWorkspaceCredentialError } = await loadStore()

    await expect(read('ws-a')).rejects.toThrow('Could not decrypt saved Plane credential')
    expect(getWorkspaceCredentialError('ws-a')).toContain(
      'Could not decrypt saved Plane credential'
    )
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('off macOS retries a failed async decrypt with the sync API', async () => {
    setPlatform('linux')
    writeTokenFile('ws-a', CIPHERTEXT_A)
    safeStorageMock.decryptStringAsync.mockRejectedValue(new Error('no async key provider'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.decryptString.mockReturnValue('token-a')
    const { read } = await loadStore()

    await expect(read('ws-a')).resolves.toBe('token-a')
    expect(safeStorageMock.decryptStringAsync).toHaveBeenCalledTimes(1)
  })

  it('on macOS with the async encryptor unavailable reports the decrypt error without a sync read', async () => {
    writeTokenFile('ws-a', CIPHERTEXT_A)
    safeStorageMock.isAsyncEncryptionAvailable.mockResolvedValue(false)
    const { read } = await loadStore()

    await expect(read('ws-a')).rejects.toThrow('Could not decrypt saved Plane credential')
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
    expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it('uses the sync API when the async encryptor is unavailable (Linux without a keyring)', async () => {
    setPlatform('linux')
    writeTokenFile('ws-a', Buffer.from('plain-token'))
    safeStorageMock.isAsyncEncryptionAvailable.mockResolvedValue(false)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const { read } = await loadStore()

    await expect(read('ws-a')).resolves.toBe('plain-token')
    expect(safeStorageMock.isAsyncEncryptionAvailable).toHaveBeenCalled()
    expect(safeStorageMock.decryptStringAsync).not.toHaveBeenCalled()
  })
})

describe('getClients', () => {
  it("under 'all' drops the workspace it cannot decrypt and keeps the others", async () => {
    writeTokenFile('ws-a', CIPHERTEXT_A)
    writeTokenFile('ws-b', CIPHERTEXT_B)
    writeWorkspaceFile(['ws-a', 'ws-b'])
    safeStorageMock.decryptStringAsync.mockImplementation(async (raw: Buffer) => {
      if (raw.equals(CIPHERTEXT_A)) {
        return { result: 'token-a', shouldReEncrypt: false }
      }
      throw new Error('cannot decrypt')
    })
    const { getClients } = await loadStore()

    const clients = await getClients('all')

    expect(clients.map((client) => client.headers['x-api-key'])).toEqual(['token-a'])
  })

  it("under 'all' skips a workspace still waiting on the Keychain and keeps the others", async () => {
    vi.useFakeTimers()
    writeTokenFile('ws-a', CIPHERTEXT_A)
    writeTokenFile('ws-b', CIPHERTEXT_B)
    writeWorkspaceFile(['ws-a', 'ws-b'])
    safeStorageMock.decryptStringAsync.mockImplementation((raw: Buffer) =>
      raw.equals(CIPHERTEXT_A)
        ? Promise.resolve({ result: 'token-a', shouldReEncrypt: false })
        : new Promise(() => {})
    )
    const { getClients } = await loadStore()

    const clients = getClients('all')
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)

    await expect(clients).resolves.toEqual([
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'token-a' }) })
    ])
  })

  it("under 'all' reports the Keychain wait when every workspace is waiting", async () => {
    vi.useFakeTimers()
    writeTokenFile('ws-a', CIPHERTEXT_A)
    writeTokenFile('ws-b', CIPHERTEXT_B)
    writeWorkspaceFile(['ws-a', 'ws-b'])
    safeStorageMock.decryptStringAsync.mockReturnValue(new Promise(() => {}))
    const { getClients } = await loadStore()

    const clients = getClients('all')
    const settled = expect(clients).rejects.toThrow('waiting for Keychain access')
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)

    await settled
  })
})
