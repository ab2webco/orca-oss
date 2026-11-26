import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testState = { dir: '' }
const { keychain, safeStorageMock, decode } = vi.hoisted(() => {
  const keychain = { syncCalls: 0, syncAllowed: true }
  const decode = (ciphertext: Buffer): string => {
    const decoded = ciphertext.toString('utf-8')
    if (!decoded.startsWith('enc:')) {
      throw new Error('invalid ciphertext')
    }
    return decoded.slice('enc:'.length + 36 + 1)
  }
  // Why: on macOS each sync call reads the Keychain on the main thread, which is the freeze under test.
  const sync =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      keychain.syncCalls += 1
      if (!keychain.syncAllowed) {
        throw new Error('sync Keychain read on the main thread')
      }
      return fn(...args)
    }
  const safeStorageMock: Record<string, unknown> = {
    isEncryptionAvailable: sync(() => true),
    encryptString: sync((plaintext: string) =>
      Buffer.from(`enc:${crypto.randomUUID()}:${plaintext}`, 'utf-8')
    ),
    decryptString: sync(decode)
  }
  return { keychain, safeStorageMock, decode }
})

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: safeStorageMock
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn().mockReturnValue({ nth_repo_added: 2 })
}))

const KEYCHAIN_WAIT_MS = 10_000
const ORIGINAL = {
  proxy: 'http://user:pass@proxy.test:8080',
  cookie: 'opencode-cookie',
  kagi: 'https://kagi.test/session/token',
  ownerLease: `ssh-owner-lease-${'x'.repeat(480)}`
} as const

type ProtectedBlobs = { proxy: string; cookie: string; kagi: string | null; ownerLease: string }

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

function persistedBlobs(): ProtectedBlobs {
  const state = JSON.parse(readFileSync(join(testState.dir, 'orca-data.json'), 'utf-8'))
  return {
    proxy: state.settings.httpProxyUrl,
    cookie: state.settings.opencodeSessionCookie,
    kagi: state.ui.browserKagiSessionLink,
    ownerLease: state.sshPtyConsumerRecoveries[0]?.ownerLease
  }
}

async function settleSave(store: Awaited<ReturnType<typeof createStore>>): Promise<void> {
  await vi.advanceTimersByTimeAsync(2_000)
  await store.waitForPendingWrite()
}

// Seeds the profile with every protected value encrypted, as a previous run left it.
async function seedEncryptedProfile(): Promise<ProtectedBlobs> {
  const store = await createStore()
  store.updateSettings({ httpProxyUrl: ORIGINAL.proxy, opencodeSessionCookie: ORIGINAL.cookie })
  store.updateUI({ browserKagiSessionLink: ORIGINAL.kagi })
  await store.upsertSshPtyConsumerRecovery({
    targetId: 'ssh-1',
    clientInstanceId: 'client-1',
    serverBuildId: 'relay-build-1',
    clientGeneration: 1,
    ownerGeneration: 1,
    ownerLease: ORIGINAL.ownerLease
  })
  await settleSave(store)
  const blobs = persistedBlobs()
  for (const [key, blob] of Object.entries(blobs)) {
    expect(blob).toBeTruthy()
    expect(blob).not.toBe(ORIGINAL[key as keyof typeof ORIGINAL])
  }
  return blobs
}

function useAsyncKeychain(decrypt: (ciphertext: Buffer) => Promise<unknown>): void {
  safeStorageMock.isAsyncEncryptionAvailable = async () => true
  safeStorageMock.decryptStringAsync = decrypt
  keychain.syncCalls = 0
  keychain.syncAllowed = false
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

const ORIGINAL_PLATFORM = process.platform

describe('protected secrets at startup when the Keychain prompts', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-keychain-wait-test-'))
    keychain.syncCalls = 0
    keychain.syncAllowed = true
    delete safeStorageMock.isAsyncEncryptionAvailable
    delete safeStorageMock.decryptStringAsync
    delete safeStorageMock.encryptStringAsync
    setPlatform('darwin')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setPlatform(ORIGINAL_PLATFORM)
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('a prompt nobody answers leaves the secrets sealed after the bound, and a later save keeps every encrypted blob', async () => {
    const seeded = await seedEncryptedProfile()
    useAsyncKeychain(() => new Promise(() => {}))

    const store = await createStore()
    expect(keychain.syncCalls).toBe(0)
    const unseal = store.unsealProtectedSecrets()
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await unseal

    expect(store.getSettings().opencodeSessionCookie).toBe('')
    expect(store.getSettings().httpProxyUrl).toBe('')
    expect(store.getUI().browserKagiSessionLink).toBe('')
    store.updateSettings({ httpProxyBypassRules: 'saved-after-timeout' })
    await settleSave(store)

    expect(persistedBlobs()).toEqual(seeded)
    expect(keychain.syncCalls).toBe(0)
  })

  it('a prompt answered after the bound still fills the secrets, tells listeners and re-applies the proxy', async () => {
    const seeded = await seedEncryptedProfile()
    let answer!: () => void
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    useAsyncKeychain(async (ciphertext) => {
      await answered
      return { result: decode(ciphertext), shouldReEncrypt: false }
    })

    const store = await createStore()
    const settingsUpdates: string[][] = []
    store.onSettingsChanged((updates) => settingsUpdates.push(Object.keys(updates)))
    const lateProxies: string[] = []
    const unseal = store.unsealProtectedSecrets((settings) =>
      lateProxies.push(settings.httpProxyUrl ?? '')
    )
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await unseal
    expect(store.getSettings().httpProxyUrl).toBe('')

    answer()
    await vi.advanceTimersByTimeAsync(0)

    expect(store.getSettings().opencodeSessionCookie).toBe(ORIGINAL.cookie)
    expect(store.getSettings().httpProxyUrl).toBe(ORIGINAL.proxy)
    expect(store.getUI().browserKagiSessionLink).toBe(ORIGINAL.kagi)
    expect(store.getSshPtyConsumerRecovery('ssh-1')?.ownerLease).toBe(ORIGINAL.ownerLease)
    expect(settingsUpdates.flat()).toEqual(
      expect.arrayContaining(['httpProxyUrl', 'opencodeSessionCookie'])
    )
    expect(lateProxies.at(-1)).toBe(ORIGINAL.proxy)
    await settleSave(store)
    expect(persistedBlobs()).toEqual(seeded)
    expect(keychain.syncCalls).toBe(0)
  })

  it('an SSH reconnect while the lease read is pending saves the new lease, and a late answer does not restore the old one', async () => {
    await seedEncryptedProfile()
    let answer!: () => void
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    useAsyncKeychain(async (ciphertext) => {
      await answered
      return { result: decode(ciphertext), shouldReEncrypt: false }
    })
    const store = await createStore()
    const unseal = store.unsealProtectedSecrets()
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await unseal
    keychain.syncAllowed = true
    const liveLease = `ssh-owner-lease-${'y'.repeat(480)}`

    // Why: the relay grants this fresh owner only after the old one expired, so its lease is the live one.
    const granted = store.upsertSshPtyConsumerRecovery({
      targetId: 'ssh-1',
      clientInstanceId: 'client-2',
      serverBuildId: 'relay-build-1',
      clientGeneration: 1,
      ownerGeneration: 2,
      ownerLease: liveLease
    })
    answer()
    await vi.advanceTimersByTimeAsync(0)
    await granted
    await settleSave(store)

    expect(store.getSshPtyConsumerRecovery('ssh-1')).toMatchObject({
      clientInstanceId: 'client-2',
      ownerLease: liveLease
    })
    expect(decode(Buffer.from(persistedBlobs().ownerLease, 'base64'))).toBe(liveLease)
  })

  it('a late answer does not undo a secret the user re-entered while the prompt was open', async () => {
    await seedEncryptedProfile()
    let answer!: () => void
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    useAsyncKeychain(async (ciphertext) => {
      await answered
      return { result: decode(ciphertext), shouldReEncrypt: false }
    })
    const store = await createStore()
    const lateProxies: string[] = []
    const unseal = store.unsealProtectedSecrets((settings) =>
      lateProxies.push(settings.httpProxyUrl ?? '')
    )
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await unseal
    keychain.syncAllowed = true
    const retyped = {
      proxy: 'http://user2:pass2@proxy2.test:8080',
      cookie: 'opencode-cookie-2',
      kagi: 'https://kagi.test/session/token-2'
    }

    store.updateSettings({ httpProxyUrl: retyped.proxy, opencodeSessionCookie: retyped.cookie })
    store.updateUI({ browserKagiSessionLink: retyped.kagi })
    answer()
    await vi.advanceTimersByTimeAsync(0)
    await settleSave(store)

    expect(store.getSettings().httpProxyUrl).toBe(retyped.proxy)
    expect(store.getSettings().opencodeSessionCookie).toBe(retyped.cookie)
    expect(store.getUI().browserKagiSessionLink).toBe(retyped.kagi)
    expect(lateProxies).toEqual([])
    const persisted = persistedBlobs()
    expect(decode(Buffer.from(persisted.proxy, 'base64'))).toBe(retyped.proxy)
    expect(decode(Buffer.from(persisted.cookie, 'base64'))).toBe(retyped.cookie)
  })

  it('an answered prompt fills the secrets, and later saves reuse their blobs without a sync Keychain read', async () => {
    const seeded = await seedEncryptedProfile()
    useAsyncKeychain(async (ciphertext) => ({ result: decode(ciphertext), shouldReEncrypt: false }))

    const store = await createStore()
    expect(keychain.syncCalls).toBe(0)
    await store.unsealProtectedSecrets()

    expect(store.getSettings().opencodeSessionCookie).toBe(ORIGINAL.cookie)
    expect(store.getSettings().httpProxyUrl).toBe(ORIGINAL.proxy)
    expect(store.getUI().browserKagiSessionLink).toBe(ORIGINAL.kagi)
    expect(store.getSshPtyConsumerRecovery('ssh-1')?.ownerLease).toBe(ORIGINAL.ownerLease)
    store.updateSettings({ httpProxyBypassRules: 'saved-after-unseal' })
    await settleSave(store)

    expect(persistedBlobs()).toEqual(seeded)
    expect(keychain.syncCalls).toBe(0)
  })

  it('on macOS a failed async decrypt keeps the blobs sealed without a sync retry', async () => {
    const seeded = await seedEncryptedProfile()
    useAsyncKeychain(async () => {
      throw new Error('temporarily unavailable')
    })

    const store = await createStore()
    expect(keychain.syncCalls).toBe(0)
    await store.unsealProtectedSecrets()
    store.updateSettings({ httpProxyBypassRules: 'saved-after-failure' })
    await settleSave(store)

    expect(store.getSettings().opencodeSessionCookie).toBe('')
    expect(persistedBlobs()).toEqual(seeded)
    expect(keychain.syncCalls).toBe(0)
  })

  it('on macOS an unavailable async encryptor (after a Deny) keeps the blobs sealed without a sync read', async () => {
    const seeded = await seedEncryptedProfile()
    useAsyncKeychain(async () => {
      throw new Error('decryptStringAsync must not run when the encryptor is unavailable')
    })
    safeStorageMock.isAsyncEncryptionAvailable = async () => false

    const store = await createStore()
    await store.unsealProtectedSecrets()
    store.updateSettings({ httpProxyBypassRules: 'saved-after-deny' })
    await settleSave(store)

    expect(store.getSettings().opencodeSessionCookie).toBe('')
    expect(persistedBlobs()).toEqual(seeded)
    expect(keychain.syncCalls).toBe(0)
  })

  it('off macOS a failed async decrypt is retried with the sync API', async () => {
    setPlatform('linux')
    await seedEncryptedProfile()
    const decryptStringAsync = vi.fn(async () => {
      throw new Error('no async key provider')
    })
    useAsyncKeychain(decryptStringAsync)
    keychain.syncAllowed = true

    const store = await createStore()
    expect(store.getSettings().opencodeSessionCookie).toBe('')
    await store.unsealProtectedSecrets()

    expect(decryptStringAsync).toHaveBeenCalled()
    expect(store.getSettings().opencodeSessionCookie).toBe(ORIGINAL.cookie)
    expect(store.getSettings().httpProxyUrl).toBe(ORIGINAL.proxy)
  })
  // Why (ORCA-1391): re-entering a secret after the startup timeout used to encrypt it with the
  // sync API, reading the Keychain on the main thread the prompt was holding.
  it('a secret re-entered after the bound is encrypted off the main thread and saved', async () => {
    await seedEncryptedProfile()
    useAsyncKeychain(() => new Promise(() => {}))
    safeStorageMock.encryptStringAsync = async (plaintext: string) =>
      Buffer.from(`enc:${crypto.randomUUID()}:${plaintext}`, 'utf-8')

    const store = await createStore()
    const unseal = store.unsealProtectedSecrets()
    await vi.advanceTimersByTimeAsync(KEYCHAIN_WAIT_MS)
    await unseal
    store.updateSettings({ httpProxyUrl: 'http://re-entered.test:3128' })
    await settleSave(store)
    await settleSave(store)

    const proxy = Buffer.from(persistedBlobs().proxy, 'base64')
    expect(decode(proxy)).toBe('http://re-entered.test:3128')
    expect(keychain.syncCalls).toBe(0)
  })

  it('the quit flush waits for a secret still encrypting', async () => {
    await seedEncryptedProfile()
    useAsyncKeychain(async (ciphertext) => ({ result: decode(ciphertext), shouldReEncrypt: false }))
    // Why: lands after 1 s, inside the 2 s bound, so a flush that does not wait misses it.
    safeStorageMock.encryptStringAsync = (plaintext: string) =>
      new Promise<Buffer>((resolve) =>
        setTimeout(() => resolve(Buffer.from(`enc:${crypto.randomUUID()}:${plaintext}`)), 1000)
      )

    const store = await createStore()
    await store.unsealProtectedSecrets()
    store.updateSettings({ opencodeSessionCookie: 'cookie-set-before-quit' })
    const flushing = store.flushAsync()
    await vi.advanceTimersByTimeAsync(2500)
    await flushing

    expect(decode(Buffer.from(persistedBlobs().cookie, 'base64'))).toBe('cookie-set-before-quit')
    expect(keychain.syncCalls).toBe(0)
  })

  it('a quit flush with an encrypt that never settles writes the rest of the state at the bound', async () => {
    await seedEncryptedProfile()
    useAsyncKeychain(async (ciphertext) => ({ result: decode(ciphertext), shouldReEncrypt: false }))
    const store = await createStore()
    await store.unsealProtectedSecrets()
    const before = persistedBlobs()
    safeStorageMock.encryptStringAsync = () => new Promise(() => {})
    store.updateSettings({ opencodeSessionCookie: 'never-encrypts', httpProxyBypassRules: 'kept' })
    let settled = false
    const quit = store.flushAsync().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await quit

    const state = JSON.parse(readFileSync(join(testState.dir, 'orca-data.json'), 'utf-8'))
    expect(state.settings.httpProxyBypassRules).toBe('kept')
    expect(persistedBlobs().cookie).toBe(before.cookie)
    expect(keychain.syncCalls).toBe(0)
  })
})
