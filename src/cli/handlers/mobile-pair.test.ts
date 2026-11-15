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
    error: { code, message: `${code} happened` },
    _meta: { runtimeId: 'runtime-1' }
  })
}

const mintedLan = {
  available: true,
  qrDataUrl: 'data:image/png;base64,AAAA',
  pairingUrl: PAIRING_URL,
  endpoint: 'ws://10.0.2.2:6768',
  deviceId: 'device-1',
  connectionMode: 'local-only'
}

const relayRefused = {
  available: false,
  reason: 'relay_mint_failed',
  guidance: 'Orca Relay could not create a pairing invite. Use LAN or retry Relay.',
  relayFailure: {
    code: 'relay_not_signed_in',
    stage: 'create_pairing_relay',
    message: 'Sign in to Orca'
  }
}

const interfaces = [
  { name: 'en0', address: '192.168.1.20', hasDefaultRoute: true },
  { name: 'utun4', address: '100.84.204.89' }
]

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
  it('maps --connection lan onto a local-only mint and prints the link with a terminal QR', async () => {
    const call = vi.fn().mockResolvedValue(ok(mintedLan))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPair(
      [
        ['connection', 'lan'],
        ['address', '10.0.2.2'],
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
    expect(printed).toContain('Connection: lan')
    // The QR is drawn from the link itself, not the PNG data URL.
    expect(printed).not.toContain('data:image/png')
    expect(printed).toMatch(/[█▀▄]/)
    expect(process.exitCode).toBeUndefined()
  })

  it('defaults to Relay, like Settings > Mobile, without rotating', async () => {
    const call = vi.fn().mockResolvedValue(ok({ ...mintedLan, connectionMode: 'automatic' }))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPair([], call)

    expect(call).toHaveBeenCalledWith(
      'pairing.createMobileQr',
      { connectionMode: 'automatic' },
      expect.anything()
    )
  })

  it('refuses a connection that is neither relay nor lan before calling the host', async () => {
    const call = vi.fn()

    await expect(runPair([['connection', 'wifi']], call)).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('relay or lan')
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('lists the host interfaces instead of minting when lan has no --address', async () => {
    const call = vi.fn().mockResolvedValue(ok({ interfaces }))

    await expect(
      runPair(
        [
          ['connection', 'lan'],
          ['environment', 'm1']
        ],
        call,
        { isRemote: true }
      )
    ).rejects.toMatchObject({
      code: 'address_required',
      message: expect.stringMatching(
        /Host "m1"[\s\S]*en0\s+192\.168\.1\.20[\s\S]*utun4\s+100\.84\.204\.89/
      ),
      data: { interfaces }
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('pairing.listNetworkInterfaces', undefined, expect.anything())
  })

  it('still asks for --address when the host cannot list its interfaces', async () => {
    const call = vi.fn().mockRejectedValue(failure('method_not_found'))

    await expect(runPair([['connection', 'lan']], call)).rejects.toMatchObject({
      code: 'address_required',
      message: expect.stringContaining('--address')
    })
  })

  it('emits the result envelope with the QR text in --json mode', async () => {
    const call = vi.fn().mockResolvedValue(ok(mintedLan))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runPair(
      [
        ['connection', 'lan'],
        ['address', '10.0.2.2']
      ],
      call,
      { json: true }
    )

    const envelope = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      result: { pairingUrl: string; connection: string; qrText: string | null; qrDataUrl?: unknown }
    }
    expect(envelope.result.pairingUrl).toBe(PAIRING_URL)
    expect(envelope.result.connection).toBe('lan')
    expect(envelope.result.qrText).toMatch(/[█▀▄]/)
    expect(envelope.result.qrDataUrl).toBeUndefined()
  })

  it('names the Relay failure code and points at --connection lan when Relay refuses', async () => {
    const call = vi.fn().mockResolvedValue(ok(relayRefused))

    await expect(runPair([['environment', 'm1']], call, { isRemote: true })).rejects.toMatchObject({
      code: 'relay_mint_failed',
      message: expect.stringMatching(
        /Host "m1"[\s\S]*relay_not_signed_in[\s\S]*--connection lan --address <ip>/
      ),
      data: { relayFailure: relayRefused.relayFailure }
    })
  })

  it('fails with the host reason and guidance for any other refusal', async () => {
    const call = vi
      .fn()
      .mockResolvedValue(
        ok({ available: false, reason: 'websocket_unavailable', guidance: 'Pick another --port.' })
      )

    await expect(
      runPair(
        [
          ['connection', 'lan'],
          ['address', '10.0.2.2']
        ],
        call
      )
    ).rejects.toMatchObject({
      code: 'websocket_unavailable',
      message: expect.stringMatching(/This Orca Lab[\s\S]*Pick another --port\./)
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
