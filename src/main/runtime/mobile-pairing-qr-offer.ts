import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'
import type { MobileRelayMintFailure } from '../../shared/mobile-relay-mint-failure'
import { encodeMobilePairingQr, type MobilePairingQrResult } from './mobile-pairing-qr'

export type MobilePairingQrArgs = {
  address?: string
  connectionMode?: MobilePairingConnectionMode
  rotate?: boolean
}

export type MobilePairingQrResponse =
  | {
      available: false
      reason?: string
      guidance?: string
      relayFailure?: MobileRelayMintFailure
    }
  | {
      available: true
      qrDataUrl: string | null
      qrError?: 'encoding_failed'
      pairingUrl: string
      /** Null when no direct address was advertised — the QR pairs over Relay alone. */
      endpoint: string | null
      deviceId: string
      /** Mode the QR actually encodes. */
      connectionMode: MobilePairingConnectionMode
    }

type PairingOfferForQr =
  | { available: false; reason: string; guidance: string; relayFailure?: MobileRelayMintFailure }
  | {
      available: true
      pairingUrl: string
      endpoint: string
      deviceId: string
      connectionMode: MobilePairingConnectionMode
    }

export type MobilePairingQrEnvironment = {
  resolveDefaultAddress: () => Promise<string | null | undefined>
  createOffer: (args: {
    address?: string | null
    connectionMode?: MobilePairingConnectionMode
    rotate?: boolean
    name: string
  }) => Promise<PairingOfferForQr>
  encodeQr?: (pairingUrl: string) => Promise<MobilePairingQrResult>
}

const NO_PAIRING_ADDRESS_GUIDANCE =
  'No reachable network address is available for pairing. Connect to Wi‑Fi or Tailscale, or pick an address manually.'

/** Mint the pairing QR for the machine that owns this runtime.
 *
 *  Why one shared builder: the desktop IPC handler and the `pairing.createMobileQr`
 *  RPC must produce byte-identical offers. The LAN no-address guard and the loopback
 *  endpoint suppression below are exactly the rules that drift when duplicated.
 */
export async function createMobilePairingQrResponse(
  environment: MobilePairingQrEnvironment,
  args: MobilePairingQrArgs = {}
): Promise<MobilePairingQrResponse> {
  // Why the caller may name the address: overlay networks (Tailscale, ZeroTier) are not
  // the default LAN IP, and the phone can only reach the one the user picked.
  const ip = args.address ?? (await environment.resolveDefaultAddress())
  // Why: the local address is optional under Relay — the QR carries the relay invite, so a host
  // with nothing auto-advertisable (only container bridges, or no interface at all) still pairs.
  // LAN-only has no relay to fall back on, so it fails closed.
  if (!ip && args.connectionMode === 'local-only') {
    return {
      available: false,
      reason: 'invalid_advertised_endpoint',
      guidance: NO_PAIRING_ADDRESS_GUIDANCE
    }
  }

  // Why rotate is passed through rather than always on: repeated regenerations coalesce onto one
  // never-scanned pending token, so the copy-button flow cannot accumulate orphaned credentials.
  // Only an explicit "Regenerate" (the prior token may have been exposed) mints a fresh one.
  const offer = await environment.createOffer({
    address: ip,
    connectionMode: args.connectionMode,
    rotate: args.rotate,
    name: `Mobile ${new Date().toLocaleDateString()}`
  })
  if (!offer.available) {
    // Why: surface Relay mint failures (and other pairing unavailability) so the UI can
    // refuse a silent LAN QR under the Relay label.
    return {
      available: false,
      reason: offer.reason,
      guidance: offer.guidance,
      ...(offer.relayFailure ? { relayFailure: offer.relayFailure } : {})
    }
  }

  const qr = await (environment.encodeQr ?? encodeMobilePairingQr)(offer.pairingUrl)
  return {
    available: true,
    qrDataUrl: qr.ok ? qr.qrDataUrl : null,
    ...(!qr.ok ? { qrError: qr.reason } : {}),
    pairingUrl: offer.pairingUrl,
    // Why: with nothing advertised the offer's endpoint is the loopback fallback, which points at
    // whichever device scans the QR — never this host. Report no endpoint so the UI omits it
    // instead of printing an address the phone can't reach.
    endpoint: ip ? offer.endpoint : null,
    deviceId: offer.deviceId,
    connectionMode: offer.connectionMode
  }
}
