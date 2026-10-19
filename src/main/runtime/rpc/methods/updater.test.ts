import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureRemoteServerUpdater } from '../../remote-server-updater'
import { STATUS_METHODS } from './status'
import { UPDATER_METHODS } from './updater'

const snapshot = {
  appVersion: '1.5.0',
  runtimeId: 'runtime-rpc',
  support: { installMode: 'interactive', automatic: true, reason: 'available' },
  status: { state: 'available', version: '1.5.1', changelog: null },
  mobileInstallRequest: null
} as const

function handler(methods: typeof UPDATER_METHODS, name: string) {
  const method = methods.find((candidate) => candidate.name === name)
  if (!method) {
    throw new Error(`Missing method ${name}`)
  }
  return method.handler
}

function method(name: string) {
  const found = UPDATER_METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing method ${name}`)
  }
  return found
}

describe('runtime updater RPC methods', () => {
  const getSnapshot = vi.fn(() => snapshot)
  const check = vi.fn(() => snapshot)
  const download = vi.fn(() => snapshot)
  const install = vi.fn(() => ({
    accepted: true as const,
    fromVersion: '1.5.0',
    targetVersion: '1.5.1',
    runtimeId: 'runtime-rpc'
  }))
  const requestMobileInstall = vi.fn(() => ({
    accepted: true as const,
    request: {
      requestId: 'req-1',
      deviceName: 'Pixel 9',
      phase: 'countdown' as const,
      deadlineAt: 31_000
    }
  }))
  const cancelMobileInstall = vi.fn(() => true)
  const restartMobileInstallNow = vi.fn(() => true)
  const runtime = {
    getRuntimeId: () => 'runtime-rpc',
    getStatus: () => ({ runtimeId: 'runtime-rpc', liveTabCount: 2, liveLeafCount: 3 }),
    getDeviceRegistry: () => ({
      validateToken: (token: string) => (token === 'phone-token' ? { name: 'Pixel 9' } : null)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    configureRemoteServerUpdater({
      getSnapshot,
      check,
      download,
      install,
      requestMobileInstall,
      cancelMobileInstall,
      restartMobileInstallNow,
      getMobileInstallRequest: () => null
    })
  })

  it('exposes status and each update transition', async () => {
    const context = { runtime } as never
    expect(await handler(UPDATER_METHODS, 'updater.getStatus')(undefined, context)).toEqual(
      snapshot
    )
    expect(
      await handler(UPDATER_METHODS, 'updater.check')(
        { includePrerelease: false, includePerfPrerelease: true },
        context
      )
    ).toBe(snapshot)
    expect(await handler(UPDATER_METHODS, 'updater.download')(undefined, context)).toBe(snapshot)
    expect(await handler(UPDATER_METHODS, 'updater.install')(undefined, context)).toMatchObject({
      accepted: true,
      runtimeId: 'runtime-rpc'
    })
    expect(check).toHaveBeenCalledWith('runtime-rpc', {
      includePrerelease: false,
      includePerfPrerelease: true
    })
  })

  it('identifies the requesting phone by its authenticated device, not by params', async () => {
    const result = await handler(UPDATER_METHODS, 'updater.requestMobileInstall')(undefined, {
      runtime,
      pairedDeviceId: 'phone-device'
    } as never)

    expect(requestMobileInstall).toHaveBeenCalledWith('phone-device')
    expect(result).toMatchObject({ accepted: true, request: { requestId: 'req-1' } })
  })

  it('accepts no version or URL from the phone', () => {
    const params = method('updater.requestMobileInstall').params
    expect(params?.safeParse({}).success).toBe(true)
    expect(params?.safeParse({ version: '9.9.9' }).success).toBe(false)
    expect(params?.safeParse({ url: 'https://example.invalid/app.zip' }).success).toBe(false)
  })

  it('relays cancel and restart-now for the desktop dialog', async () => {
    const context = { runtime } as never
    expect(
      await handler(UPDATER_METHODS, 'updater.cancelMobileInstall')({ requestId: 'req-1' }, context)
    ).toBe(true)
    expect(
      await handler(UPDATER_METHODS, 'updater.restartMobileInstallNow')(
        { requestId: 'req-1' },
        context
      )
    ).toBe(true)
    expect(cancelMobileInstall).toHaveBeenCalledWith('req-1')
    expect(restartMobileInstallNow).toHaveBeenCalledWith('req-1')
  })

  it('enriches status.get without changing the runtime status source', async () => {
    const result = await handler(STATUS_METHODS, 'status.get')(undefined, { runtime } as never)
    expect(result).toEqual({
      runtimeId: 'runtime-rpc',
      liveTabCount: 2,
      liveLeafCount: 3,
      appVersion: '1.5.0',
      remoteUpdateSupport: snapshot.support
    })
  })
})
