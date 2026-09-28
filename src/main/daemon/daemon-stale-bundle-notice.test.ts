import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

const writeFileAtomically = vi.fn()
const readNoticeFile = vi.fn()
const readVerifiedDaemonPid = vi.fn()
const isDaemonStaleForCurrentBundle = vi.fn()

vi.mock('../codex-accounts/fs-utils', () => ({
  writeFileAtomically: (...args: unknown[]) => writeFileAtomically(...args)
}))
vi.mock('../persistence', () => ({
  getCanonicalUserDataPath: () => '/tmp/orca-stale-bundle-notice-test'
}))
vi.mock('./daemon-pid-identity', () => ({
  readVerifiedDaemonPid: (...args: unknown[]) => readVerifiedDaemonPid(...args)
}))
vi.mock('./daemon-bundle-staleness', () => ({
  isDaemonStaleForCurrentBundle: (...args: unknown[]) => isDaemonStaleForCurrentBundle(...args)
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  readFileSync: (...args: unknown[]) => readNoticeFile(...args)
}))

const {
  dismissStaleBundleNotice,
  getDaemonStaleBundleNoticeStatus,
  resetStaleBundleNoticeStateForTests
} = await import('./daemon-stale-bundle-notice')

const DEPS = {
  runtimeDir: '/tmp/orca-runtime',
  socketPath: '/tmp/orca-runtime/daemon.sock',
  tokenPath: '/tmp/orca-runtime/daemon.token',
  currentAppVersion: '1.4.160-lab.89.rc',
  isPackaged: true
}

beforeEach(() => {
  resetStaleBundleNoticeStateForTests()
  writeFileAtomically.mockClear()
  readNoticeFile.mockReset()
  readNoticeFile.mockImplementation(() => {
    throw new Error('ENOENT')
  })
  readVerifiedDaemonPid.mockReset()
  isDaemonStaleForCurrentBundle.mockReset()
})

describe('getDaemonStaleBundleNoticeStatus', () => {
  it('reports stale with the daemon instance identity when the adopted daemon predates the bundle', async () => {
    readVerifiedDaemonPid.mockResolvedValue({ pid: 4242, startedAtMs: 1_000 })
    isDaemonStaleForCurrentBundle.mockResolvedValue(true)

    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: true, pid: 4242, startedAtMs: 1_000, dismissed: false })
    expect(isDaemonStaleForCurrentBundle).toHaveBeenCalledWith(
      DEPS.runtimeDir,
      DEPS.socketPath,
      DEPS.tokenPath,
      DEPS.currentAppVersion
    )
  })

  it('reports not stale when the adopted daemon matches the current bundle (covers the zero-session replace-then-adopt case)', async () => {
    readVerifiedDaemonPid.mockResolvedValue({ pid: 4242, startedAtMs: 1_000 })
    isDaemonStaleForCurrentBundle.mockResolvedValue(false)

    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: false })
  })

  it('never probes when the app is not packaged', async () => {
    const status = await getDaemonStaleBundleNoticeStatus({ ...DEPS, isPackaged: false })

    expect(status).toEqual({ stale: false })
    expect(readVerifiedDaemonPid).not.toHaveBeenCalled()
    expect(isDaemonStaleForCurrentBundle).not.toHaveBeenCalled()
  })

  it('reports not stale when no verified daemon identity is available', async () => {
    readVerifiedDaemonPid.mockResolvedValue(null)

    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: false })
    expect(isDaemonStaleForCurrentBundle).not.toHaveBeenCalled()
  })

  it('treats a daemon missing appVersion as stale — the documented fallback in isDaemonStaleForCurrentBundle', async () => {
    // Why this belongs here, not in daemon-bundle-staleness.test.ts: that suite already covers
    // appVersion === null -> true; this asserts the notice status correctly surfaces that verdict.
    readVerifiedDaemonPid.mockResolvedValue({ pid: 7, startedAtMs: null })
    isDaemonStaleForCurrentBundle.mockResolvedValue(true)

    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: true, pid: 7, startedAtMs: null, dismissed: false })
  })

  it('marks the status dismissed once dismissStaleBundleNotice was called for that exact pid+startedAtMs', async () => {
    readVerifiedDaemonPid.mockResolvedValue({ pid: 9, startedAtMs: 500 })
    isDaemonStaleForCurrentBundle.mockResolvedValue(true)
    dismissStaleBundleNotice(9, 500)

    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: true, pid: 9, startedAtMs: 500, dismissed: true })
  })

  it('does not carry a dismissal over to a different daemon instance (new pid or start time)', async () => {
    readVerifiedDaemonPid.mockResolvedValue({ pid: 9, startedAtMs: 500 })
    isDaemonStaleForCurrentBundle.mockResolvedValue(true)
    dismissStaleBundleNotice(9, 500)

    readVerifiedDaemonPid.mockResolvedValue({ pid: 9, startedAtMs: 999 })
    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: true, pid: 9, startedAtMs: 999, dismissed: false })
  })

  it('reads a dismissal persisted from a previous process (module state reset simulates app relaunch)', async () => {
    readNoticeFile.mockImplementation(() => JSON.stringify({ dismissedInstanceKey: '4242:1000' }))
    readVerifiedDaemonPid.mockResolvedValue({ pid: 4242, startedAtMs: 1_000 })
    isDaemonStaleForCurrentBundle.mockResolvedValue(true)

    const status = await getDaemonStaleBundleNoticeStatus(DEPS)

    expect(status).toEqual({ stale: true, pid: 4242, startedAtMs: 1_000, dismissed: true })
  })
})

describe('dismissStaleBundleNotice', () => {
  it('persists the dismissed instance key atomically', () => {
    dismissStaleBundleNotice(123, 456)

    expect(writeFileAtomically).toHaveBeenCalledTimes(1)
    const [path, contents] = writeFileAtomically.mock.calls[0] as [string, string]
    expect(path).toContain('daemon-stale-bundle-notice.json')
    expect(JSON.parse(contents)).toEqual({ dismissedInstanceKey: '123:456' })
  })
})
