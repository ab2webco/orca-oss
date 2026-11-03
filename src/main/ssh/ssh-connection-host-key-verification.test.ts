import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clientInstances,
  connectAttempts,
  resetSshConnectionMocks,
  resolveWithSshGMock,
  spawnSystemSshMock,
  ssh2Mock
} from './ssh-connection-test-harness'
import { loadHostKeyTrustSourcesMock, rememberHostKeyMock } from './ssh-host-key-trust-sources-mock'
import { createCallbacks, createResolvedConfig, createTarget } from './ssh-connection-test-fixtures'
import { SshConnection } from './ssh-connection'
import { parseKnownHosts } from './ssh-known-hosts'
import { hostKeyBlob, knownHostsLine } from './ssh-host-key-test-keys'

vi.mock('ssh2', async () => (await import('./ssh-connection-test-harness')).createSsh2Module())
vi.mock('./ssh-host-key-trust-sources', async () =>
  (await import('./ssh-host-key-trust-sources-mock')).createHostKeyTrustSourcesModule()
)
vi.mock('./system-ssh-binary', async () =>
  (await import('./ssh-connection-test-harness')).createSystemSshBinaryModule()
)
vi.mock('./ssh-system-fallback', async () =>
  (await import('./ssh-connection-test-harness')).createSystemFallbackModule()
)
vi.mock('./ssh-control-socket', async () =>
  (await import('./ssh-connection-test-harness')).createControlSocketModule()
)
vi.mock('./ssh-config-parser', async () =>
  (await import('./ssh-connection-test-harness')).createSshConfigParserModule()
)

function knownHosts(contents: string): void {
  loadHostKeyTrustSourcesMock.mockResolvedValue({
    knownHosts: parseKnownHosts(contents),
    trustSourceUnreadable: false,
    orcaStore: []
  })
}

describe('SshConnection host key verification', () => {
  beforeEach(() => {
    resetSshConnectionMocks()
  })

  it('refuses a host whose key differs from known_hosts, without prompting or falling back', async () => {
    knownHosts(knownHostsLine('example.com', 'ssh-ed25519', 9))
    const callbacks = createCallbacks({
      onCredentialRequest: vi.fn(async () => 'secret')
    })
    const conn = new SshConnection(createTarget(), callbacks)

    await expect(conn.connect()).rejects.toThrow(/Host key verification failed for example\.com/)

    expect(conn.getState().status).toBe('error')
    expect(callbacks.onCredentialRequest).not.toHaveBeenCalled()
    expect(spawnSystemSshMock).not.toHaveBeenCalled()
    expect(rememberHostKeyMock).not.toHaveBeenCalled()
    expect(connectAttempts).toBe(1)
  })

  it('refuses the host before any handshake when the trust sources cannot be loaded', async () => {
    loadHostKeyTrustSourcesMock.mockRejectedValue(new Error('userData path unavailable'))
    const callbacks = createCallbacks({
      onCredentialRequest: vi.fn(async () => 'secret')
    })
    const conn = new SshConnection(createTarget(), callbacks)

    await expect(conn.connect()).rejects.toThrow(/Host key verification failed for example\.com/)

    expect(callbacks.onCredentialRequest).not.toHaveBeenCalled()
    expect(spawnSystemSshMock).not.toHaveBeenCalled()
    expect(connectAttempts).toBe(0)
  })

  it('accepts and remembers a first-contact host key', async () => {
    const conn = new SshConnection(createTarget({ port: 2222 }), createCallbacks())

    await conn.connect()

    expect(conn.getState().status).toBe('connected')
    expect(rememberHostKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'example.com',
        port: 2222,
        keyType: 'ssh-ed25519'
      })
    )
  })

  it('connects to a known host without re-recording it', async () => {
    knownHosts(knownHostsLine('example.com', 'ssh-ed25519', 1))
    const conn = new SshConnection(createTarget(), createCallbacks())

    await conn.connect()

    expect(conn.getState().status).toBe('connected')
    expect(rememberHostKeyMock).not.toHaveBeenCalled()
  })

  it('proposes the known key type first and refuses another type for that host', async () => {
    knownHosts(knownHostsLine('example.com', 'ssh-rsa', 1))
    const conn = new SshConnection(createTarget(), createCallbacks())

    await expect(conn.connect()).rejects.toThrow(/Host key verification failed/)

    const config = clientInstances[0].lastConnectConfig as {
      algorithms?: { serverHostKey?: string[] }
    }
    expect(config.algorithms?.serverHostKey?.[0]).toBe('rsa-sha2-512')
  })

  it('reads the known_hosts files and HostKeyAlias that ssh -G reports', async () => {
    resolveWithSshGMock.mockResolvedValue(
      createResolvedConfig({
        proxyUseFdpass: false,
        knownHostsFiles: ['/custom/known_hosts'],
        hostKeyAlias: 'alias.example'
      })
    )
    knownHosts(knownHostsLine('alias.example', 'ssh-ed25519', 9))
    const conn = new SshConnection(createTarget({ configHost: 'prod' }), createCallbacks())

    await expect(conn.connect()).rejects.toThrow(/Host key verification failed for alias\.example/)
    expect(loadHostKeyTrustSourcesMock).toHaveBeenCalledWith(['/custom/known_hosts'])
  })

  it('accepts an on-demand runtime VM without recording its throwaway key', async () => {
    const conn = new SshConnection(
      createTarget({ owner: { type: 'on-demand-runtime', runtimeId: 'vm-1' } }),
      createCallbacks()
    )
    ssh2Mock.hostKey = hostKeyBlob('ssh-ed25519', 4)

    await conn.connect()

    expect(conn.getState().status).toBe('connected')
    expect(rememberHostKeyMock).not.toHaveBeenCalled()
  })
})
