import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostKeyBlob, knownHostsLine } from './ssh-host-key-test-keys'

const userData = vi.hoisted(() => ({ path: '' }))
vi.mock('../persistence', () => ({
  getCanonicalUserDataPath: () => userData.path
}))

import { loadHostKeyTrustSources, rememberHostKey } from './ssh-host-key-trust-sources'

describe('host key trust sources', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-host-keys-'))
    userData.path = join(dir, 'user-data')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('unions known_hosts files and flags one that exists but cannot be read', async () => {
    const a = join(dir, 'a')
    await writeFile(a, `${knownHostsLine('a.example', 'ssh-ed25519', 1)}\n`)
    const unreadable = join(dir, 'is-a-directory')
    await mkdir(unreadable)

    const sources = await loadHostKeyTrustSources([a, join(dir, 'missing'), a])
    expect(sources.knownHosts).toHaveLength(1)
    expect(sources.trustSourceUnreadable).toBe(false)

    expect((await loadHostKeyTrustSources([a, unreadable])).trustSourceUnreadable).toBe(true)
  })

  it('flags an Orca store that exists but cannot be read, since it may hold a pinned key', async () => {
    await mkdir(join(userData.path, 'ssh', 'known_hosts'), { recursive: true })

    const sources = await loadHostKeyTrustSources([join(dir, 'missing')])
    expect(sources.trustSourceUnreadable).toBe(true)
  })

  it('records accepted keys in its own store and reads them back', async () => {
    await rememberHostKey({
      host: 'Host.Example',
      port: 2222,
      keyType: 'ssh-ed25519',
      key: hostKeyBlob('ssh-ed25519', 3)
    })

    const storePath = join(userData.path, 'ssh', 'known_hosts')
    expect(await readFile(storePath, 'utf8')).toMatch(/^\[host\.example\]:2222 ssh-ed25519 \S+\n$/)
    if (process.platform !== 'win32') {
      expect((await stat(storePath)).mode & 0o777).toBe(0o600)
    }
    const { orcaStore } = await loadHostKeyTrustSources([join(dir, 'missing')])
    expect(orcaStore).toHaveLength(1)
  })

  it('refuses to store a host that could split or mark a known_hosts line', async () => {
    for (const host of ['a b', 'a,b', '@revoked', '*.example']) {
      await rememberHostKey({
        host,
        port: 22,
        keyType: 'ssh-ed25519',
        key: hostKeyBlob('ssh-ed25519', 1)
      })
    }
    await expect(readFile(join(userData.path, 'ssh', 'known_hosts'))).rejects.toThrow()
  })
})
