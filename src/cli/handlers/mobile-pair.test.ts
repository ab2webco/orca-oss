import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeRpcFailureError } from '../runtime-client'
import { MOBILE_PAIR_HANDLERS } from './mobile-pair'

const PAIRING_URL = 'orca://pair?v=2#eyJ0b2tlbiI6InQifQ'

function ok<T>(result: T) {
  return { id: 'req-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function failure(code: string): RuntimeRpcFailureError {
  return new RuntimeRpcFailureError({
    id: 'req-1',
    ok: false,
    error: { code, message: `Unknown method: pairing.createMobileQr` },
    _meta: { runtimeId: 'runtime-1' }
  })
}

const minted = {
  available: true,
  qrDataUrl: 'data:image/png;base64,AAAA',
  pairingUrl: PAIRING_URL,
  endpoint: 'ws://10.0.2.2:6768',
  deviceId: 'device-1',
  connectionMode: 'local-only'
}

async function runPair(
  flags: [string, string | boolean][],
  call: ReturnType<typeof vi.fn>,
  options: { json?: boolean; isRemote?: boolean } = {}
): Promise<void> {
  await MOBILE_PAIR_HANDLERS['mobile pair']!({
    client: { call, isRemote: options.isRemote ?? false } as never,
    cwd: '/tmp',
    flags: new Map(flags),
    json: options.json ?? false
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('orca mobile pair', () => {
  it('maps its flags onto pairing.createMobileQr and prints the link with a terminal QR', async () => {
    const call = vi.fn().mockResolvedValue(ok(minted))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPair(
      [
        ['address', '10.0.2.2'],
        ['local-only', true],
        ['rotate', true]
      ],
      call
    )

    expect(call).toHaveBeenCalledWith(
      'pairing.createMobileQr',
      { address: '10.0.2.2', connectionMode: 'local-only', rotate: true },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
    const printed = log.mock.calls.map((args) => String(args[0])).join('\n')
    expect(printed).toContain(PAIRING_URL)
    expect(printed).toContain('ws://10.0.2.2:6768')
    // The QR is drawn from the link itself, not the PNG data URL.
    expect(printed).not.toContain('data:image/png')
    expect(printed).toMatch(/[█▀▄]/)
    expect(process.exitCode).toBeUndefined()
  })

  it('asks for automatic mode and no rotation when those flags are absent', async () => {
    const call = vi.fn().mockResolvedValue(ok(minted))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPair([], call)

    expect(call).toHaveBeenCalledWith('pairing.createMobileQr', {}, expect.anything())
  })

  it('emits the result envelope with the QR text in --json mode', async () => {
    const call = vi.fn().mockResolvedValue(ok(minted))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPair([['address', '10.0.2.2']], call, { json: true })

    const envelope = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      result: {
        pairingUrl: string
        qrText: string | null
        qrDataUrl?: unknown
      }
    }
    expect(envelope.result.pairingUrl).toBe(PAIRING_URL)
    expect(envelope.result.qrText).toMatch(/[█▀▄]/)
    expect(envelope.result.qrDataUrl).toBeUndefined()
  })

  it('fails with the host reason and guidance when the host cannot mint', async () => {
    const call = vi.fn().mockResolvedValue(
      ok({
        available: false,
        reason: 'relay_mint_failed',
        guidance: 'Orca Relay could not create a pairing invite. Use LAN or retry Relay.'
      })
    )
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(runPair([], call)).rejects.toMatchObject({
      code: 'relay_mint_failed',
      message: expect.stringContaining('Orca Relay could not create a pairing invite')
    })
  })

  it('points an automatic pairing that Relay refused at --local-only', async () => {
    const call = vi
      .fn()
      .mockResolvedValue(
        ok({ available: false, reason: 'relay_mint_failed', guidance: 'Relay is down.' })
      )

    await expect(runPair([['environment', 'm1']], call, { isRemote: true })).rejects.toMatchObject({
      message: expect.stringMatching(/Host "m1".*Retry with --local-only/)
    })
  })

  it('names the host and its version when a paired host is too old for the method', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'pairing.createMobileQr') {
        throw failure('method_not_found')
      }
      return ok({ appVersion: '1.3.40' })
    })

    await expect(runPair([['environment', 'm1']], call, { isRemote: true })).rejects.toMatchObject({
      code: 'method_not_supported',
      message: expect.stringMatching(/m1.*1\.3\.40/)
    })
  })

  it('still names the host when its version cannot be read', async () => {
    const call = vi.fn(async (method: string) => {
      throw failure(method === 'pairing.createMobileQr' ? 'method_not_found' : 'timeout')
    })

    await expect(runPair([['environment', 'm1']], call, { isRemote: true })).rejects.toMatchObject({
      code: 'method_not_supported',
      message: expect.stringMatching(/m1.*unknown version/)
    })
  })
})
