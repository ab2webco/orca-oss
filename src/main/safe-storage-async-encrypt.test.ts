import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CredentialStoreModule from './bitbucket/credential-store'
import type * as SiteCredentialStoreModule from './jira/site-credential-store'
import type * as LinearTokenStoreModule from './linear/linear-token-store'
import type * as MinimaxCookieStoreModule from './minimax/minimax-cookie-store'
import type * as ProfileCloudSessionStoreModule from './orca-profiles/profile-cloud-session-store'
import type * as PlaneTokenStorageModule from './plane/plane-token-storage'
import type * as PluginSecretsStoreModule from './plugins/plugin-secrets-store'
import type * as ProtectedSecretPersistenceModule from './protected-secret-persistence'
import type * as SafeStorageAsyncEncryptModule from './safe-storage-async-encrypt'
import type * as OpenaiApiKeyStoreModule from './speech/openai-api-key-store'

const { safeStorageMock } = vi.hoisted(() => ({
  safeStorageMock: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`sync:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^v10:/, '')),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`v10:${value}`)),
    decryptStringAsync: vi.fn(),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret')
  }
}))

let tempHome = ''
const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function load<T>(path: string): Promise<T> {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock, app: { getPath: () => tempHome } }))
  for (const id of ['os', 'node:os']) {
    vi.doMock(id, async () => {
      const actual = await vi.importActual<typeof Os>('node:os')
      return { ...actual, homedir: () => tempHome }
    })
  }
  return (await import(path)) as T
}

function expectNoSyncEncryption(): void {
  expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
  expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-async-encrypt-'))
  setPlatform('darwin')
  vi.clearAllMocks()
  safeStorageMock.isAsyncEncryptionAvailable.mockImplementation(async () => true)
  safeStorageMock.encryptStringAsync.mockImplementation(async (value: string) =>
    Buffer.from(`v10:${value}`)
  )
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
})

afterEach(() => {
  setPlatform(originalPlatform)
  rmSync(tempHome, { recursive: true, force: true })
})

describe('encryptSecretOffMainThread', () => {
  type Helper = typeof SafeStorageAsyncEncryptModule

  it('uses the async encryptor on macOS', async () => {
    const { encryptSecretOffMainThread } = await load<Helper>('./safe-storage-async-encrypt')
    expect((await encryptSecretOffMainThread('s'))?.toString()).toBe('v10:s')
    expectNoSyncEncryption()
  })

  it('uses the async encryptor on Linux with GNOME libsecret', async () => {
    setPlatform('linux')
    safeStorageMock.encryptStringAsync.mockImplementation(async (value: string) =>
      Buffer.from(`v11:${value}`)
    )
    const { encryptSecretOffMainThread } = await load<Helper>('./safe-storage-async-encrypt')
    expect((await encryptSecretOffMainThread('s'))?.toString()).toBe('v11:s')
    expectNoSyncEncryption()
  })

  // Why: measured live on Electron 43.8.6 with no keyring reachable: async reports available and
  // writes v10 blobs that the sync decryptString refuses, so the secret would be lost.
  it('keeps the sync pair on Linux when the async blob is not keyring-backed', async () => {
    setPlatform('linux')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const { encryptSecretOffMainThread } = await load<Helper>('./safe-storage-async-encrypt')
    expect(await encryptSecretOffMainThread('s')).toBeNull()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    expect((await encryptSecretOffMainThread('s'))?.toString()).toBe('sync:s')
  })

  it.each(['basic_text', 'kwallet5', 'kwallet6', 'unknown'])(
    'keeps the sync pair on Linux with the %s backend',
    async (backend) => {
      setPlatform('linux')
      safeStorageMock.getSelectedStorageBackend.mockReturnValue(backend)
      const helper = await load<Helper>('./safe-storage-async-encrypt')
      expect(helper.canEncryptOffMainThread()).toBe(false)
      expect((await helper.encryptSecretOffMainThread('s'))?.toString()).toBe('sync:s')
      expect(safeStorageMock.encryptStringAsync).not.toHaveBeenCalled()
    }
  )

  it('keeps the sync pair on Windows', async () => {
    setPlatform('win32')
    const helper = await load<Helper>('./safe-storage-async-encrypt')
    expect(helper.canEncryptOffMainThread()).toBe(false)
    expect((await helper.encryptSecretOffMainThread('s'))?.toString()).toBe('sync:s')
    expect(safeStorageMock.encryptStringAsync).not.toHaveBeenCalled()
  })

  it('falls back to the sync pair when the async encryptor is unavailable', async () => {
    safeStorageMock.isAsyncEncryptionAvailable.mockImplementation(async () => false)
    const { encryptSecretOffMainThread } = await load<Helper>('./safe-storage-async-encrypt')
    expect((await encryptSecretOffMainThread('s'))?.toString()).toBe('sync:s')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(await encryptSecretOffMainThread('s')).toBeNull()
  })
})

describe('save paths make no sync encrypt call when async is available', () => {
  it('Plane token', async () => {
    const store = await load<typeof PlaneTokenStorageModule>('./plane/plane-token-storage')
    await store.saveWorkspaceToken('ws', 'plane-key')
    expectNoSyncEncryption()
    const path = join(
      tempHome,
      '.orca',
      'plane-tokens',
      `${Buffer.from('ws').toString('base64url')}.enc`
    )
    expect(readFileSync(path, 'utf8')).toBe('v10:plane-key')
  })

  it('Linear token', async () => {
    const store = await load<typeof LinearTokenStoreModule>('./linear/linear-token-store')
    const paths = await import('./linear/linear-credential-paths')
    await store.saveWorkspaceToken('ws', 'linear-key')
    expectNoSyncEncryption()
    expect(readFileSync(paths.getWorkspaceTokenPath('ws'), 'utf8')).toBe('v10:linear-key')
  })

  it('Jira token', async () => {
    const store = await load<typeof SiteCredentialStoreModule>('./jira/site-credential-store')
    await store.saveToken('site', 'jira-key')
    expectNoSyncEncryption()
    expect(await store.readToken('site')).toBe('jira-key')
  })

  it('Bitbucket credential', async () => {
    const store = await load<typeof CredentialStoreModule>('./bitbucket/credential-store')
    await store.saveBitbucketCredential({
      authMode: 'token',
      email: null,
      baseUrl: null,
      account: 'ada',
      accessToken: 'bb-key',
      apiToken: null
    })
    expectNoSyncEncryption()
    expect(readFileSync(join(tempHome, '.orca', 'bitbucket-credential.enc'), 'utf8')).toMatch(
      /^v10:\{.*"accessToken":"bb-key"/
    )
  })

  it('MiniMax cookie', async () => {
    const store = await load<typeof MinimaxCookieStoreModule>('./minimax/minimax-cookie-store')
    await store.saveMiniMaxSessionCookie('_token=abc')
    expectNoSyncEncryption()
    expect(store.readMiniMaxSessionCookie()).toBe('_token=abc')
  })

  it('OpenAI speech key', async () => {
    const store = await load<typeof OpenaiApiKeyStoreModule>('./speech/openai-api-key-store')
    await store.saveOpenAiSpeechApiKey('sk-1')
    expectNoSyncEncryption()
    expect(readFileSync(join(tempHome, '.orca', 'openai-speech-token.enc'), 'utf8')).toBe(
      'v10:sk-1'
    )
  })

  it('Orca Cloud session', async () => {
    const store = await load<typeof ProfileCloudSessionStoreModule>(
      './orca-profiles/profile-cloud-session-store'
    )
    const session = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1,
      capabilities: { flags: {}, refreshedAt: 1 }
    }
    expect(await store.saveOrcaCloudSession('p', tempHome, session)).toBe('encrypted')
    expectNoSyncEncryption()
    const persisted = JSON.parse(readFileSync(store.getOrcaCloudSessionPath('p', tempHome), 'utf8'))
    expect(Buffer.from(persisted.ciphertext, 'base64').toString()).toBe(
      `v10:${JSON.stringify(session)}`
    )
  })

  it('plugin secret', async () => {
    const { PluginSecretsStore } = await load<typeof PluginSecretsStoreModule>(
      './plugins/plugin-secrets-store'
    )
    expect(await new PluginSecretsStore(tempHome, 'acme.first').set('k', 'v')).toEqual({
      ok: true,
      value: true
    })
    expectNoSyncEncryption()
  })

  it('protected settings secret', async () => {
    const { ProtectedSecretPersistence } = await load<typeof ProtectedSecretPersistenceModule>(
      './protected-secret-persistence'
    )
    const secrets = new ProtectedSecretPersistence()
    const onEncrypted = vi.fn()
    secrets.setAsyncEncryptionListener(onEncrypted)
    expect(secrets.encrypt('slot', 'proxy')).toEqual({ blob: '', degraded: true })
    await secrets.pendingEncryptions()
    expect(onEncrypted).toHaveBeenCalledTimes(1)
    const blob = Buffer.from('v10:proxy').toString('base64')
    const encrypted = secrets.encrypt('slot', 'proxy')
    expect(encrypted).toEqual({ blob, degraded: false, retentionUpdate: { slot: 'slot', blob } })
    secrets.commitRetentionUpdates([encrypted.retentionUpdate!])
    // Why: an unchanged secret must reuse its blob, or every save would re-encrypt and save again.
    expect(secrets.encrypt('slot', 'proxy').blob).toBe(blob)
    expect(safeStorageMock.encryptStringAsync).toHaveBeenCalledTimes(1)
    expectNoSyncEncryption()
  })
})

describe('a save that awaits the encryptor', () => {
  it('reads back through the sync decryptString older builds use', async () => {
    const store = await load<typeof PlaneTokenStorageModule>('./plane/plane-token-storage')
    const file = await import('./integration-credential-file')
    await store.saveWorkspaceToken('ws', 'plane-key')
    const path = join(
      tempHome,
      '.orca',
      'plane-tokens',
      `${Buffer.from('ws').toString('base64url')}.enc`
    )
    expect(file.readStoredCredentialToken('Plane', readFileSync(path))).toBe('plane-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledWith(Buffer.from('v10:plane-key'))
  })

  it('does not resurrect a token deleted while it encrypted', async () => {
    const pending = deferred<Buffer<ArrayBuffer>>()
    safeStorageMock.encryptStringAsync.mockImplementationOnce(() => pending.promise)
    const store = await load<typeof PlaneTokenStorageModule>('./plane/plane-token-storage')
    const save = store.saveWorkspaceToken('ws', 'plane-key')
    await vi.waitFor(() => expect(safeStorageMock.encryptStringAsync).toHaveBeenCalled())
    store.deleteWorkspaceToken('ws')
    pending.resolve(Buffer.from('v10:plane-key'))
    await expect(save).rejects.toThrow('Disconnected before the token was saved.')
    expect(store.hasStoredWorkspaceToken('ws')).toBe(false)
  })

  it('lets the later of two saves win when the first encrypts slower', async () => {
    const slow = deferred<Buffer<ArrayBuffer>>()
    safeStorageMock.encryptStringAsync.mockImplementationOnce(() => slow.promise)
    const store = await load<typeof OpenaiApiKeyStoreModule>('./speech/openai-api-key-store')
    const first = store.saveOpenAiSpeechApiKey('old')
    await vi.waitFor(() => expect(safeStorageMock.encryptStringAsync).toHaveBeenCalled())
    await store.saveOpenAiSpeechApiKey('new')
    slow.resolve(Buffer.from('v10:old'))
    await first
    expect(readFileSync(join(tempHome, '.orca', 'openai-speech-token.enc'), 'utf8')).toBe('v10:new')
  })

  it('keeps both of two plugin secrets set concurrently', async () => {
    const { PluginSecretsStore } = await load<typeof PluginSecretsStoreModule>(
      './plugins/plugin-secrets-store'
    )
    const vault = new PluginSecretsStore(tempHome, 'acme.first')
    await Promise.all([vault.set('a', '1'), vault.set('b', '2')])
    expect(vault.get('a')).toEqual({ ok: true, value: '1' })
    expect(vault.get('b')).toEqual({ ok: true, value: '2' })
  })

  it('drops a cloud session refresh that went stale during the encrypt', async () => {
    const store = await load<typeof ProfileCloudSessionStoreModule>(
      './orca-profiles/profile-cloud-session-store'
    )
    let current = true
    const session = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1,
      capabilities: { flags: {}, refreshedAt: 1 }
    }
    safeStorageMock.encryptStringAsync.mockImplementationOnce(async (value: string) => {
      current = false
      return Buffer.from(`v10:${value}`)
    })
    expect(await store.saveOrcaCloudSession('p', tempHome, session, () => current)).toBeNull()
    expect(existsSync(store.getOrcaCloudSessionPath('p', tempHome))).toBe(false)
  })
})

describe('a cloud session merge during a refresh save', () => {
  it('keeps the rotated refresh token', async () => {
    const store = await load<typeof ProfileCloudSessionStoreModule>(
      './orca-profiles/profile-cloud-session-store'
    )
    const s0 = {
      accessToken: 'a0',
      refreshToken: 'r0',
      expiresAt: 1,
      capabilities: { flags: {}, refreshedAt: 1 }
    }
    await store.saveOrcaCloudSession('p', tempHome, s0)
    const held = deferred<Buffer<ArrayBuffer>>()
    safeStorageMock.encryptStringAsync.mockImplementationOnce(() => held.promise)
    const refreshSave = store.saveOrcaCloudSession('p', tempHome, {
      ...s0,
      accessToken: 'a1',
      refreshToken: 'r1'
    })
    await vi.waitFor(() => expect(safeStorageMock.encryptStringAsync).toHaveBeenCalledTimes(2))
    const read = store.readOrcaCloudSession('p', tempHome)
    if (read.status !== 'found') {
      throw new Error('expected a session')
    }
    const mergeSave = store.saveOrcaCloudSession('p', tempHome, {
      ...read.session,
      capabilities: { flags: { merged: true }, refreshedAt: 2 }
    })
    // Why: give an unqueued merge time to land first, so the refresh would overwrite it.
    await new Promise((resolve) => setTimeout(resolve, 10))
    held.resolve(
      Buffer.from(`v10:${JSON.stringify({ ...s0, accessToken: 'a1', refreshToken: 'r1' })}`)
    )

    expect(await refreshSave).toBe('encrypted')
    expect(await mergeSave).toBe('encrypted')
    const persisted = JSON.parse(readFileSync(store.getOrcaCloudSessionPath('p', tempHome), 'utf8'))
    const onDisk = JSON.parse(
      Buffer.from(persisted.ciphertext, 'base64').toString().replace(/^v10:/, '')
    )
    expect(onDisk).toMatchObject({
      refreshToken: 'r1',
      capabilities: { flags: { merged: true } }
    })
    expect(store.readOrcaCloudSession('p', tempHome)).toMatchObject({
      status: 'found',
      session: {
        refreshToken: 'r1',
        capabilities: { flags: { merged: true } }
      }
    })
  })
})

describe('a delete while a save encrypts', () => {
  async function expectDeleteWins(
    save: () => Promise<unknown>,
    remove: () => void,
    isStored: () => boolean
  ): Promise<void> {
    const pending = deferred<Buffer<ArrayBuffer>>()
    safeStorageMock.encryptStringAsync.mockImplementationOnce(() => pending.promise)
    const saving = save()
    await vi.waitFor(() => expect(safeStorageMock.encryptStringAsync).toHaveBeenCalled())
    remove()
    pending.resolve(Buffer.from('v10:late'))
    await saving
    expect(isStored()).toBe(false)
  }

  it('Bitbucket credential', async () => {
    const store = await load<typeof CredentialStoreModule>('./bitbucket/credential-store')
    await expectDeleteWins(
      () =>
        store.saveBitbucketCredential({
          authMode: 'token',
          email: null,
          baseUrl: null,
          account: 'ada',
          accessToken: 'bb-key',
          apiToken: null
        }),
      store.clearStoredBitbucketCredential,
      store.hasStoredBitbucketCredential
    )
  })

  it('OpenAI speech key', async () => {
    const store = await load<typeof OpenaiApiKeyStoreModule>('./speech/openai-api-key-store')
    await expectDeleteWins(
      () => store.saveOpenAiSpeechApiKey('sk-1'),
      store.clearOpenAiSpeechApiKey,
      store.hasOpenAiSpeechApiKey
    )
  })

  it('MiniMax cookie', async () => {
    const store = await load<typeof MinimaxCookieStoreModule>('./minimax/minimax-cookie-store')
    await expectDeleteWins(
      () => store.saveMiniMaxSessionCookie('_token=abc'),
      store.clearMiniMaxSessionCookie,
      store.hasMiniMaxSessionCookie
    )
  })

  it('plugin secret', async () => {
    const { PluginSecretsStore } = await load<typeof PluginSecretsStoreModule>(
      './plugins/plugin-secrets-store'
    )
    const vault = new PluginSecretsStore(tempHome, 'acme.first')
    await expectDeleteWins(
      () => vault.set('k', 'v'),
      () => vault.delete('k'),
      () => vault.get('k').ok && (vault.get('k') as { value: string | null }).value !== null
    )
  })

  it('Orca Cloud session', async () => {
    const store = await load<typeof ProfileCloudSessionStoreModule>(
      './orca-profiles/profile-cloud-session-store'
    )
    const session = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1,
      capabilities: { flags: {}, refreshedAt: 1 }
    }
    await expectDeleteWins(
      () => store.saveOrcaCloudSession('p', tempHome, session),
      () => store.clearOrcaCloudSession('p', tempHome),
      () =>
        existsSync(store.getOrcaCloudSessionPath('p', tempHome)) ||
        store.readOrcaCloudSession('p', tempHome).status === 'found'
    )
  })
})
