import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { dirname, join } from 'node:path'
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
const CIPHERTEXT = Buffer.from([0x76, 0x31, 0x30, 0x01, 0x02, 0x41])
const BITBUCKET_SECRET = JSON.stringify({ accessToken: 'token-a', apiToken: null })

let tempHome = ''

type StoreCase = {
  service: string
  tokenPath: () => string
  plaintext: string
  // Loads the store module; the async reader asserts behaviour, not the sync-vs-async shape.
  load: () => Promise<() => Promise<unknown>>
  expected: unknown
}

const b64 = (id: string): string => Buffer.from(id).toString('base64url')

const STORES: StoreCase[] = [
  {
    service: 'Linear',
    tokenPath: () => join(tempHome, '.orca', 'linear-tokens', `${b64('ws-a')}.enc`),
    plaintext: 'token-a',
    load: async () => {
      const { loadToken } = await import('./linear/linear-token-store')
      return async () => loadToken({ force: true, workspaceId: 'ws-a' })
    },
    expected: 'token-a'
  },
  {
    service: 'Jira',
    tokenPath: () => join(tempHome, '.orca', 'jira-tokens', `${b64('site-a')}.enc`),
    plaintext: 'token-a',
    load: async () => {
      const { readToken } = await import('./jira/site-credential-store')
      return async () => readToken('site-a')
    },
    expected: 'token-a'
  },
  {
    service: 'Bitbucket',
    tokenPath: () => join(tempHome, '.orca', 'bitbucket-credential.enc'),
    plaintext: BITBUCKET_SECRET,
    load: async () => {
      const { loadStoredBitbucketSecret } = await import('./bitbucket/credential-store')
      return async () => loadStoredBitbucketSecret({ force: true })
    },
    expected: expect.objectContaining({ accessToken: 'token-a' })
  }
]

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function writeToken(store: StoreCase, bytes: Buffer): void {
  mkdirSync(dirname(store.tokenPath()), { recursive: true })
  writeFileSync(store.tokenPath(), bytes)
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

const ORIGINAL_PLATFORM = process.platform

beforeEach(() => {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  for (const specifier of ['os', 'node:os']) {
    vi.doMock(specifier, async () => {
      const actual = await vi.importActual<typeof Os>('node:os')
      return { ...actual, homedir: () => tempHome }
    })
  }
  tempHome = mkdtempSync(join(tmpdir(), 'orca-integration-token-'))
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

describe.each(STORES)('$service token read on macOS', (store) => {
  it('decrypts with the async API and never touches the sync Keychain calls', async () => {
    const read = await store.load()
    writeToken(store, CIPHERTEXT)
    safeStorageMock.decryptStringAsync.mockResolvedValue({
      result: store.plaintext,
      shouldReEncrypt: false
    })

    await expect(read()).resolves.toEqual(store.expected)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
    expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it('fails an unanswered Keychain prompt after the bound, then serves the answer from one request', async () => {
    const read = await store.load()
    vi.useFakeTimers()
    writeToken(store, CIPHERTEXT)
    const prompt = deferred<{ result: string; shouldReEncrypt: boolean }>()
    safeStorageMock.decryptStringAsync.mockReturnValue(prompt.promise)

    const first = read()
    const second = read()
    const outcome = Promise.all([
      expect(first).rejects.toThrow('waiting for Keychain access'),
      expect(second).rejects.toMatchObject({ name: 'CredentialKeychainWaitError' })
    ])
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await outcome

    prompt.resolve({ result: store.plaintext, shouldReEncrypt: false })
    await vi.advanceTimersByTimeAsync(0)
    await expect(read()).resolves.toEqual(store.expected)
    expect(safeStorageMock.decryptStringAsync).toHaveBeenCalledTimes(1)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('with the async encryptor unavailable, reports the decrypt error without a sync read', async () => {
    const read = await store.load()
    writeToken(store, CIPHERTEXT)
    safeStorageMock.isAsyncEncryptionAvailable.mockResolvedValue(false)

    await expect(read()).rejects.toThrow(`Could not decrypt saved ${store.service} credential`)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
    expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
  })
})

describe.each(STORES)('$service token read off macOS', (store) => {
  it('keeps the sync path when the async encryptor is unavailable (Linux without a keyring)', async () => {
    setPlatform('linux')
    const read = await store.load()
    writeToken(store, Buffer.from(store.plaintext))
    safeStorageMock.isAsyncEncryptionAvailable.mockResolvedValue(false)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

    await expect(read()).resolves.toEqual(store.expected)
    expect(safeStorageMock.isEncryptionAvailable).toHaveBeenCalled()
    expect(safeStorageMock.decryptStringAsync).not.toHaveBeenCalled()
  })
})
