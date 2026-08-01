import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from './types'

// Why: reconcileSeededClaudeLivePtys is only reachable through initDaemonPtyProvider, so these
// tests reuse the same adapter/spawner fake shape as daemon-init.test.ts. The single addition is
// listSessionsControl, which lets each test drive the retry path (fail-always, fail-then-succeed,
// respond-with-list) without waiting on real backoff.
const {
  getPathMock,
  getAppPathMock,
  isPackagedMock,
  probeSocketExistsMock,
  writeFileSyncMock,
  readFileSyncMock,
  unlinkSyncMock,
  netConnectMock,
  forkMock,
  checkDaemonHealthMock,
  healthCheckDaemonMock,
  getMacDaemonSystemResolverHealthMock,
  getDaemonLaunchIdentityMock,
  isDaemonStaleForCurrentBundleMock,
  killStaleDaemonMock,
  getProcessStartedAtMsMock,
  parseDaemonPidFileMock,
  unlinkOwnedDaemonPidFileMock,
  daemonClientMock,
  adapterInstances,
  listSessionsControl,
  getLocalPtyProviderMock,
  setLocalPtyProviderMock,
  unbindLocalProviderListenersMock,
  rebindLocalProviderListenersMock,
  trackDaemonReplacedMock,
  trackDaemonRetiredMock
} = vi.hoisted(() => {
  const getPathMock = vi.fn(() => '/fake/userData')
  const getAppPathMock = vi.fn(() => '/fake/app')
  const isPackagedMock = vi.fn(() => false)

  const probeSocketExistsMock = vi.fn((_path?: string) => false)
  const writeFileSyncMock = vi.fn()
  // Why: readFileSync throws so createLegacyDaemonAdapters treats every legacy pid file as absent.
  const readFileSyncMock = vi.fn((): string => {
    throw new Error('ENOENT')
  })
  const unlinkSyncMock = vi.fn()
  const forkMock = vi.fn()
  const netConnectMock = vi.fn(() => {
    const handlers: Record<string, (() => void)[]> = { connect: [], error: [] }
    return {
      on(event: string, cb: () => void) {
        handlers[event]?.push(cb)
        if (event === 'error') {
          queueMicrotask(() => cb())
        }
        return this
      },
      removeListener(event: string, cb: () => void) {
        handlers[event] = handlers[event]?.filter((handler) => handler !== cb) ?? []
        return this
      },
      destroy() {}
    }
  })

  const checkDaemonHealthMock = vi.fn(async () => 'healthy')
  const healthCheckDaemonMock = vi.fn(async () => true)
  const getMacDaemonSystemResolverHealthMock = vi.fn(() => 'healthy')
  const getDaemonLaunchIdentityMock = vi.fn(() => 'match')
  const isDaemonStaleForCurrentBundleMock = vi.fn(() => false)
  const killStaleDaemonMock = vi.fn(async () => true)
  const getProcessStartedAtMsMock = vi.fn((): number | null => 1_000_000)
  const parseDaemonPidFileMock = vi.fn(
    (): { pid: number; startedAtMs: number | null } | null => null
  )
  const unlinkOwnedDaemonPidFileMock = vi.fn(() => true)

  const daemonClientMock = vi.fn().mockImplementation(function MockDaemonClient() {
    return {
      ensureConnected: vi.fn(async () => {}),
      request: vi.fn(async () => ({ sessions: [] })),
      disconnect: vi.fn()
    }
  })

  const adapterInstances: MockAdapter[] = []
  // Why: built inside initDaemonPtyProvider, so each test sets this before init to script listSessions.
  const listSessionsControl: {
    current: null | (() => Promise<{ sessionId: string }[]>)
  } = { current: null }

  const localFallbackProvider = {
    routesFreshSpawnsToLocalProvider: undefined,
    spawn: vi.fn(async (opts: { sessionId?: string }) => ({
      id: opts.sessionId ?? 'local-fallback-pty'
    })),
    attach: vi.fn(async () => {}),
    hasPty: vi.fn(() => false),
    write: vi.fn(),
    resize: vi.fn(),
    shutdown: vi.fn(async () => {}),
    sendSignal: vi.fn(async () => {}),
    getCwd: vi.fn(async () => ''),
    getInitialCwd: vi.fn(async () => ''),
    clearBuffer: vi.fn(async () => {}),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(async () => false),
    getForegroundProcess: vi.fn(async () => null),
    serialize: vi.fn(async () => '{}'),
    revive: vi.fn(async () => {}),
    listProcesses: vi.fn(async () => []),
    getDefaultShell: vi.fn(async () => '/bin/zsh'),
    getProfiles: vi.fn(async () => []),
    onData: vi.fn(() => () => {}),
    onReplay: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {})
  }
  const getLocalPtyProviderMock = vi.fn(() => localFallbackProvider)
  const setLocalPtyProviderMock = vi.fn()
  const unbindLocalProviderListenersMock = vi.fn()
  const rebindLocalProviderListenersMock = vi.fn()
  const trackDaemonReplacedMock = vi.fn()
  const trackDaemonRetiredMock = vi.fn()

  return {
    getPathMock,
    getAppPathMock,
    isPackagedMock,
    probeSocketExistsMock,
    writeFileSyncMock,
    readFileSyncMock,
    unlinkSyncMock,
    netConnectMock,
    forkMock,
    checkDaemonHealthMock,
    healthCheckDaemonMock,
    getMacDaemonSystemResolverHealthMock,
    getDaemonLaunchIdentityMock,
    isDaemonStaleForCurrentBundleMock,
    killStaleDaemonMock,
    getProcessStartedAtMsMock,
    parseDaemonPidFileMock,
    unlinkOwnedDaemonPidFileMock,
    daemonClientMock,
    adapterInstances,
    listSessionsControl,
    getLocalPtyProviderMock,
    localFallbackProvider,
    setLocalPtyProviderMock,
    unbindLocalProviderListenersMock,
    rebindLocalProviderListenersMock,
    trackDaemonReplacedMock,
    trackDaemonRetiredMock
  }
})

type MockAdapter = {
  protocolVersion: number
  options: {
    socketPath: string
    tokenPath: string
    historyPath?: string
    respawn?: (reason: 'daemon_died' | 'unhealthy_resolver') => Promise<void>
    protocolVersion?: number
  }
  getActiveSessionIds: ReturnType<typeof vi.fn>
  fanoutSyntheticExits: ReturnType<typeof vi.fn>
  listProcesses: ReturnType<typeof vi.fn>
  listSessions: ReturnType<typeof vi.fn>
  establishLifecycleLease: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  disconnectOnly: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedMock()
    },
    getPath: getPathMock,
    getAppPath: getAppPathMock,
    getVersion: () => '1.2.3'
  }
}))

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: (p: string) => probeSocketExistsMock(p) || p.includes('.pid'),
  unlinkSync: unlinkSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock
}))

// Why: daemon-init now reaches daemon-ready-identity, which promisifies execFile at
// module load. Mirror daemon-init.test.ts and override only fork. (#11606)
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fork: forkMock
}))

vi.mock('net', () => ({ connect: netConnectMock }))

vi.mock('./daemon-health', () => ({
  checkDaemonHealth: checkDaemonHealthMock,
  getDaemonLaunchIdentity: getDaemonLaunchIdentityMock,
  getMacDaemonSystemResolverHealth: getMacDaemonSystemResolverHealthMock,
  healthCheckDaemon: healthCheckDaemonMock,
  isDaemonStaleForCurrentBundle: isDaemonStaleForCurrentBundleMock,
  killStaleDaemon: killStaleDaemonMock,
  getProcessStartedAtMs: getProcessStartedAtMsMock,
  parseDaemonPidFile: parseDaemonPidFileMock
}))

vi.mock('./client', () => ({ DaemonClient: daemonClientMock }))

vi.mock('./daemon-lifecycle-event', () => ({
  trackDaemonReplaced: trackDaemonReplacedMock,
  trackDaemonRetired: trackDaemonRetiredMock
}))

vi.mock('./daemon-spawner', () => ({
  DaemonSpawner: class MockDaemonSpawner {
    readonly launcher: unknown
    readonly ensureRunning: ReturnType<typeof vi.fn>
    readonly resetHandle: ReturnType<typeof vi.fn>
    readonly shutdown: ReturnType<typeof vi.fn>
    readonly getHandle: ReturnType<typeof vi.fn>
    private socketCounter: number
    private handle: {
      releaseAdoptionLease?: () => void
      shutdown: () => Promise<void>
    } | null
    constructor(opts: { runtimeDir: string; launcher: unknown }) {
      this.launcher = opts.launcher
      this.socketCounter = 0
      this.handle = null
      this.ensureRunning = vi.fn(async () => {
        this.socketCounter += 1
        const releaseAdoptionLease = vi.fn()
        this.handle = { releaseAdoptionLease, shutdown: vi.fn(async () => {}) }
        return {
          socketPath: `/fake/socket-${this.socketCounter}`,
          tokenPath: `/fake/token-${this.socketCounter}`
        }
      })
      this.resetHandle = vi.fn()
      this.shutdown = vi.fn(async () => {})
      this.getHandle = vi.fn(() => this.handle)
    }
  },
  getDaemonSocketPath: (_dir: string, version?: number) =>
    `/fake/daemon/daemon-v${version ?? PROTOCOL_VERSION}.sock`,
  getDaemonTokenPath: (_dir: string, version?: number) =>
    `/fake/daemon/daemon-v${version ?? PROTOCOL_VERSION}.token`,
  getDaemonPidPath: (_dir: string, version?: number) =>
    `/fake/daemon/daemon-v${version ?? PROTOCOL_VERSION}.pid`,
  serializeDaemonPidFile: (obj: unknown) => JSON.stringify(obj),
  unlinkOwnedDaemonPidFile: unlinkOwnedDaemonPidFileMock
}))

vi.mock('./daemon-pty-adapter', () => ({
  DaemonPtyAdapter: class MockDaemonPtyAdapter {
    readonly protocolVersion: number
    readonly options: MockAdapter['options']
    readonly getActiveSessionIds: ReturnType<typeof vi.fn>
    readonly fanoutSyntheticExits: ReturnType<typeof vi.fn>
    readonly listProcesses: ReturnType<typeof vi.fn>
    readonly listSessions: ReturnType<typeof vi.fn>
    readonly establishLifecycleLease: ReturnType<typeof vi.fn>
    readonly shutdown: ReturnType<typeof vi.fn>
    readonly dispose: ReturnType<typeof vi.fn>
    readonly disconnectOnly: ReturnType<typeof vi.fn>
    readonly onData: ReturnType<typeof vi.fn>
    readonly onExit: ReturnType<typeof vi.fn>
    constructor(opts: MockAdapter['options']) {
      this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION
      this.options = opts
      this.getActiveSessionIds = vi.fn(() => [] as string[])
      this.fanoutSyntheticExits = vi.fn()
      this.listProcesses = vi.fn(async () => [])
      this.listSessions = vi.fn(() =>
        listSessionsControl.current ? listSessionsControl.current() : Promise.resolve([])
      )
      this.establishLifecycleLease = vi.fn(async () => {})
      this.shutdown = vi.fn(async () => {})
      this.dispose = vi.fn()
      this.disconnectOnly = vi.fn(async () => {})
      this.onData = vi.fn(() => () => {})
      this.onExit = vi.fn(() => () => {})
      adapterInstances.push(this as unknown as MockAdapter)
    }
  }
}))

vi.mock('../ipc/pty', () => ({
  getLocalPtyProvider: getLocalPtyProviderMock,
  setLocalPtyProvider: setLocalPtyProviderMock,
  unbindLocalProviderListeners: unbindLocalProviderListenersMock,
  rebindLocalProviderListeners: rebindLocalProviderListenersMock
}))

async function importFresh() {
  vi.resetModules()
  adapterInstances.length = 0
  listSessionsControl.current = null
  getLocalPtyProviderMock.mockClear()
  setLocalPtyProviderMock.mockClear()
  unbindLocalProviderListenersMock.mockClear()
  rebindLocalProviderListenersMock.mockClear()
  trackDaemonReplacedMock.mockClear()
  trackDaemonRetiredMock.mockClear()
  checkDaemonHealthMock.mockClear()
  checkDaemonHealthMock.mockResolvedValue('healthy')
  healthCheckDaemonMock.mockClear()
  healthCheckDaemonMock.mockResolvedValue(true)
  getMacDaemonSystemResolverHealthMock.mockReset()
  getMacDaemonSystemResolverHealthMock.mockReturnValue('healthy')
  getDaemonLaunchIdentityMock.mockClear()
  isDaemonStaleForCurrentBundleMock.mockReset()
  isDaemonStaleForCurrentBundleMock.mockReturnValue(false)
  killStaleDaemonMock.mockReset()
  killStaleDaemonMock.mockResolvedValue(true)
  getAppPathMock.mockReset()
  getAppPathMock.mockReturnValue('/fake/app')
  forkMock.mockReset()
  isPackagedMock.mockReset()
  isPackagedMock.mockReturnValue(false)
  daemonClientMock.mockReset()
  daemonClientMock.mockImplementation(function MockDaemonClient() {
    return {
      ensureConnected: vi.fn(async () => {}),
      request: vi.fn(async () => ({ sessions: [] })),
      disconnect: vi.fn()
    }
  })
  probeSocketExistsMock.mockClear()
  probeSocketExistsMock.mockReturnValue(false)
  writeFileSyncMock.mockClear()
  readFileSyncMock.mockReset()
  readFileSyncMock.mockImplementation(() => {
    throw new Error('ENOENT')
  })
  unlinkSyncMock.mockClear()
  parseDaemonPidFileMock.mockReset()
  parseDaemonPidFileMock.mockReturnValue(null)
  unlinkOwnedDaemonPidFileMock.mockReset()
  unlinkOwnedDaemonPidFileMock.mockReturnValue(true)
  getProcessStartedAtMsMock.mockReset()
  getProcessStartedAtMsMock.mockReturnValue(1_000_000)
  // Why: import after resetModules so module-level adapter state starts fresh per test.
  return import('./daemon-init')
}

describe('daemon-init: reconcileSeededClaudeLivePtys', () => {
  beforeEach(() => {
    probeSocketExistsMock.mockReturnValue(false)
    netConnectMock.mockReset()
    netConnectMock.mockImplementation(() => {
      const handlers: Record<string, (() => void)[]> = { connect: [], error: [] }
      return {
        on(event: string, cb: () => void) {
          handlers[event]?.push(cb)
          if (event === 'error') {
            queueMicrotask(() => cb())
          }
          return this
        },
        removeListener(event: string, cb: () => void) {
          handlers[event] = handlers[event]?.filter((handler) => handler !== cb) ?? []
          return this
        },
        destroy() {}
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // Why: the backoff between retries is setTimeout(500 × attempt); drive it with fake timers so the
  // 1.5s worst case never blocks the suite. Advances past the full 500 + 1000ms budget in one shot.
  // The caller must pass the same module instance it seeded the gate against — re-importing here
  // would reset modules and hand reconcile a different gate than the one holding the seeds.
  async function initFlushingRetryBackoff(mod: Awaited<ReturnType<typeof importFresh>>) {
    const initP = mod.initDaemonPtyProvider()
    await vi.advanceTimersByTimeAsync(1500)
    await initP
  }

  it('releases seeded Claude live-PTY ids when every daemon is unreachable after the retry budget', async () => {
    vi.useFakeTimers()
    const mod = await importFresh()
    const gate = await import('../claude-accounts/live-pty-gate')
    listSessionsControl.current = async () => {
      throw new Error('daemon unreachable')
    }
    gate.seedLiveClaudePtysFromPersistence(['seed-stuck-1', 'seed-stuck-2'])

    await initFlushingRetryBackoff(mod)

    // Why: the user's bug — no daemon answers, so the gate that was blocking every account
    // mutation must drop instead of re-seeding forever from persistence.
    expect(gate.hasLiveClaudePtys()).toBe(false)
    expect(gate.hasSeededUnconfirmedClaudePtys()).toBe(false)
    // The full 3-attempt budget was spent before concluding "unreachable".
    expect(adapterInstances[0].listSessions).toHaveBeenCalledTimes(3)
  })

  it('keeps a seeded Claude live-PTY id the daemon still reports as alive', async () => {
    const mod = await importFresh()
    const gate = await import('../claude-accounts/live-pty-gate')
    listSessionsControl.current = async () => [{ sessionId: 'seed-alive' }]
    gate.seedLiveClaudePtysFromPersistence(['seed-alive', 'seed-dead'])

    await mod.initDaemonPtyProvider()

    expect(gate.hasLiveClaudePtys()).toBe(true)
    gate.markClaudePtyExited('seed-alive')
    // Why: 'seed-dead' was released by the reconcile, so the alive session held the gate alone.
    expect(gate.hasLiveClaudePtys()).toBe(false)
    expect(adapterInstances[0].listSessions).toHaveBeenCalledTimes(1)
  })

  it('releases a seeded Claude live-PTY id the daemon no longer reports', async () => {
    const mod = await importFresh()
    const gate = await import('../claude-accounts/live-pty-gate')
    listSessionsControl.current = async () => [{ sessionId: 'unrelated-live' }]
    gate.seedLiveClaudePtysFromPersistence(['seed-gone'])

    await mod.initDaemonPtyProvider()

    // Why: the daemon answered and did not list the seeded id — confirmed dead, so it must not
    // keep blocking account management.
    expect(gate.hasLiveClaudePtys()).toBe(false)
    expect(gate.hasSeededUnconfirmedClaudePtys()).toBe(false)
  })

  it('does not release anything when the first listing fails but the second succeeds', async () => {
    vi.useFakeTimers()
    const mod = await importFresh()
    const gate = await import('../claude-accounts/live-pty-gate')
    let attempts = 0
    listSessionsControl.current = async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('transient')
      }
      return [{ sessionId: 'seed-alive' }]
    }
    gate.seedLiveClaudePtysFromPersistence(['seed-alive'])

    await initFlushingRetryBackoff(mod)

    // Why: retries exist so a hiccup is not mistaken for "unreachable". The second attempt
    // recovered, so nothing was released and the alive seed stays in the gate.
    expect(attempts).toBe(2)
    expect(adapterInstances[0].listSessions).toHaveBeenCalledTimes(2)
    expect(gate.hasLiveClaudePtys()).toBe(true)
    gate.markClaudePtyExited('seed-alive')
    expect(gate.hasLiveClaudePtys()).toBe(false)
  })

  it('warns when it releases seeded ids because a daemon stayed unreachable', async () => {
    vi.useFakeTimers()
    const mod = await importFresh()
    const gate = await import('../claude-accounts/live-pty-gate')
    listSessionsControl.current = async () => {
      throw new Error('daemon unreachable')
    }
    gate.seedLiveClaudePtysFromPersistence(['seed-stuck'])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await initFlushingRetryBackoff(mod)

      // Why: this warn is the only in-product signal that the gate was force-released; losing it
      // silently re-introduces an un diagnosable lockout.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Releasing seeded Claude live-PTY gate')
      )
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unreachable'))
    } finally {
      warnSpy.mockRestore()
    }
  })
})
