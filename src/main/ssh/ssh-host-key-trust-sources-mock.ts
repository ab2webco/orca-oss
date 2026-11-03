import { vi } from 'vitest'
import type * as trustSources from './ssh-host-key-trust-sources'
import type { HostKeyTrustSources } from './ssh-host-key-trust-sources'

type TrustSourcesModule = typeof trustSources

const emptyTrustSources = (): HostKeyTrustSources => ({
  knownHosts: [],
  knownHostsUnreadable: false,
  orcaStore: []
})

/** Keeps SSH connection tests off the developer's real known_hosts and Orca data folder. */
export const loadHostKeyTrustSourcesMock = vi.fn<TrustSourcesModule['loadHostKeyTrustSources']>()
export const rememberHostKeyMock = vi.fn<TrustSourcesModule['rememberHostKey']>()

export function resetHostKeyTrustSourcesMocks(): void {
  loadHostKeyTrustSourcesMock.mockReset()
  loadHostKeyTrustSourcesMock.mockImplementation(async () => emptyTrustSources())
  rememberHostKeyMock.mockReset()
  rememberHostKeyMock.mockResolvedValue(undefined)
}
resetHostKeyTrustSourcesMocks()

export function createHostKeyTrustSourcesModule(): TrustSourcesModule {
  return {
    loadHostKeyTrustSources: loadHostKeyTrustSourcesMock,
    rememberHostKey: rememberHostKeyMock
  }
}
