import type { RuntimeStatus } from '../../shared/runtime-types'
import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'
import type { MobileRelayMintFailure } from '../../shared/mobile-relay-mint-failure'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

/** Matches the desktop wizard's budget: a Relay offer waits on the Relay invite. */
const PAIRING_QR_TIMEOUT_MS = 20_000
const HOST_READ_TIMEOUT_MS = 5_000

/** The two choices of Settings > Mobile > Connection method, by the names the UI shows. */
export type MobilePairConnection = 'relay' | 'lan'

const CONNECTION_MODES: Record<MobilePairConnection, MobilePairingConnectionMode> = {
  relay: 'automatic',
  lan: 'local-only'
}

type MobilePairingQrResponse =
  | {
      available: false
      reason?: string
      guidance?: string
      relayFailure?: MobileRelayMintFailure
    }
  | {
      available: true
      qrDataUrl: string | null
      pairingUrl: string
      endpoint: string | null
      deviceId: string
      connectionMode: MobilePairingConnectionMode
    }

type PairingNetworkInterface = { name: string; address: string; hasDefaultRoute?: boolean }

export type MobilePairResult = {
  pairingUrl: string
  endpoint: string | null
  deviceId: string
  connection: MobilePairConnection
  /** The paired host that minted it, or null for this machine's own runtime. */
  host: string | null
  qrText: string | null
}

export const MOBILE_PAIR_HANDLERS: Record<string, CommandHandler> = {
  'mobile pair': async (ctx) => {
    const connection = readConnection(ctx)
    const host = ctx.client.isRemote ? hostLabel(ctx) : null
    const address = getOptionalStringFlag(ctx.flags, 'address')
    if (connection === 'lan' && address === undefined) {
      // Why: LAN pairs over one address only, and like the UI dropdown the person picks it.
      throw await addressRequired(ctx, host)
    }
    const response = await mintOnHost(ctx, host, {
      ...(address !== undefined ? { address } : {}),
      connectionMode: CONNECTION_MODES[connection],
      ...(ctx.flags.get('rotate') === true ? { rotate: true } : {})
    })
    const qr = response.result
    if (!qr.available) {
      throw refusal(qr, host)
    }
    const result: MobilePairResult = {
      pairingUrl: qr.pairingUrl,
      endpoint: qr.endpoint,
      deviceId: qr.deviceId,
      connection: qr.connectionMode === 'local-only' ? 'lan' : 'relay',
      host,
      qrText: await renderTerminalQr(qr.pairingUrl)
    }
    printResult({ ...response, result }, ctx.json, formatMobilePair)
  }
}

function readConnection(ctx: HandlerContext): MobilePairConnection {
  const value = getOptionalStringFlag(ctx.flags, 'connection') ?? 'relay'
  if (value !== 'relay' && value !== 'lan') {
    throw new RuntimeClientError(
      'invalid_argument',
      `--connection must be relay or lan, not "${value}".`
    )
  }
  return value
}

function hostName(host: string | null): string {
  return host ? `Host "${host}"` : 'This Orca Lab'
}

function refusal(
  qr: Extract<MobilePairingQrResponse, { available: false }>,
  host: string | null
): RuntimeClientError {
  const reason = qr.reason ?? 'pairing_unavailable'
  const lines = [`${hostName(host)} could not mint a pairing link (${reason}).`]
  if (qr.relayFailure) {
    lines.push(`Relay failure: ${qr.relayFailure.code} at ${qr.relayFailure.stage}.`)
  }
  if (qr.guidance) {
    lines.push(qr.guidance)
  }
  if (reason === 'relay_mint_failed') {
    // Why: Relay fails closed, and an emulator or LAN phone never needs it.
    lines.push('Pair over LAN instead: --connection lan --address <ip>.')
  }
  return new RuntimeClientError(
    reason,
    lines.join('\n'),
    qr.relayFailure ? { relayFailure: qr.relayFailure } : undefined
  )
}

async function addressRequired(
  ctx: HandlerContext,
  host: string | null
): Promise<RuntimeClientError> {
  const interfaces = await readHostInterfaces(ctx)
  const lines = ['--connection lan needs --address: the address the phone dials.']
  if (interfaces && interfaces.length > 0) {
    lines.push(`${hostName(host)} has these addresses:`)
    for (const entry of interfaces) {
      lines.push(`  ${entry.name.padEnd(12)} ${entry.address}`)
    }
  }
  lines.push('An Android emulator reaches the machine it runs on at 10.0.2.2.')
  return new RuntimeClientError(
    'address_required',
    lines.join('\n'),
    interfaces ? { interfaces } : undefined
  )
}

async function readHostInterfaces(ctx: HandlerContext): Promise<PairingNetworkInterface[] | null> {
  try {
    const { result } = await ctx.client.call<{ interfaces: PairingNetworkInterface[] }>(
      'pairing.listNetworkInterfaces',
      undefined,
      { timeoutMs: HOST_READ_TIMEOUT_MS }
    )
    return result.interfaces
  } catch {
    // Why: an older host cannot list them; asking for --address still holds.
    return null
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
      `${hostName(host)} (Orca Lab ${version ?? 'unknown version'}) cannot mint a mobile pairing link. Update it, or pair from Settings > Mobile on that machine.`
    )
  }
}

async function readHostVersion(ctx: HandlerContext): Promise<string | null> {
  try {
    const { result } = await ctx.client.call<RuntimeStatus>('status.get', undefined, {
      timeoutMs: HOST_READ_TIMEOUT_MS
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
    `Connection: ${result.connection}`,
    `Host: ${result.host ?? 'this machine'}`
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}
