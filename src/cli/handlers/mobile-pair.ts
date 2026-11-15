import type { RuntimeStatus } from '../../shared/runtime-types'
import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

/** Matches the desktop wizard's budget: an automatic offer waits on the Relay invite. */
const PAIRING_QR_TIMEOUT_MS = 20_000
const STATUS_TIMEOUT_MS = 5_000

type MobilePairingQrResponse =
  | { available: false; reason?: string; guidance?: string }
  | {
      available: true
      qrDataUrl: string | null
      pairingUrl: string
      endpoint: string | null
      deviceId: string
      connectionMode: MobilePairingConnectionMode
    }

export type MobilePairResult = {
  pairingUrl: string
  endpoint: string | null
  deviceId: string
  connectionMode: MobilePairingConnectionMode
  /** The paired host that minted it, or null for this machine's own runtime. */
  host: string | null
  qrText: string | null
}

export const MOBILE_PAIR_HANDLERS: Record<string, CommandHandler> = {
  'mobile pair': async (ctx) => {
    const host = ctx.client.isRemote ? hostLabel(ctx) : null
    const params = {
      ...optionalEntry('address', getOptionalStringFlag(ctx.flags, 'address')),
      ...(ctx.flags.get('local-only') === true ? { connectionMode: 'local-only' as const } : {}),
      ...(ctx.flags.get('rotate') === true ? { rotate: true } : {})
    }
    const response = await mintOnHost(ctx, host, params)
    const qr = response.result
    if (!qr.available) {
      throw new RuntimeClientError(
        qr.reason ?? 'pairing_unavailable',
        `${host ? `Host "${host}"` : 'This Orca Lab'} could not mint a pairing link (${qr.reason ?? 'unknown reason'}). ${qr.guidance ?? ''}`.trim()
      )
    }
    const result: MobilePairResult = {
      pairingUrl: qr.pairingUrl,
      endpoint: qr.endpoint,
      deviceId: qr.deviceId,
      connectionMode: qr.connectionMode,
      host,
      qrText: await renderTerminalQr(qr.pairingUrl)
    }
    printResult({ ...response, result }, ctx.json, formatMobilePair)
  }
}

async function mintOnHost(
  ctx: HandlerContext,
  host: string | null,
  params: Record<string, unknown>
): Promise<{
  id: string
  ok: true
  result: MobilePairingQrResponse
  _meta: { runtimeId: string }
}> {
  try {
    return await ctx.client.call<MobilePairingQrResponse>('pairing.createMobileQr', params, {
      timeoutMs: PAIRING_QR_TIMEOUT_MS
    })
  } catch (error) {
    if (!(error instanceof RuntimeClientError) || error.code !== 'method_not_found') {
      throw error
    }
    // Why: hosts update independently, so name which one and at what version needs updating.
    const version = await readHostVersion(ctx)
    throw new RuntimeClientError(
      'method_not_supported',
      `${host ? `Host "${host}"` : 'This Orca Lab'} (Orca Lab ${version ?? 'unknown version'}) cannot mint a mobile pairing link. Update it, or pair from Settings > Mobile on that machine.`
    )
  }
}

async function readHostVersion(ctx: HandlerContext): Promise<string | null> {
  try {
    const { result } = await ctx.client.call<RuntimeStatus>('status.get', undefined, {
      timeoutMs: STATUS_TIMEOUT_MS
    })
    return result.appVersion ?? null
  } catch {
    return null
  }
}

function hostLabel(ctx: HandlerContext): string {
  return (
    getOptionalStringFlag(ctx.flags, 'environment') ?? process.env.ORCA_ENVIRONMENT ?? 'paired host'
  )
}

function optionalEntry<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}

async function renderTerminalQr(pairingUrl: string): Promise<string | null> {
  // Why dynamic: only this command needs qrcode, so every other CLI call skips parsing it.
  const QRCode = await import('qrcode')
  try {
    return await QRCode.toString(pairingUrl, { type: 'terminal', small: true })
  } catch {
    return null
  }
}

function formatMobilePair(result: MobilePairResult): string {
  return [
    result.qrText ?? '',
    `Pairing URL: ${result.pairingUrl}`,
    `Endpoint: ${result.endpoint ?? 'none (pairs over Relay)'}`,
    `Mode: ${result.connectionMode}`,
    `Host: ${result.host ?? 'this machine'}`
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}
