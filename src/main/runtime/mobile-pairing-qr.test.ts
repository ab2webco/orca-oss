import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer } from '../../shared/pairing'
import type { PairingOffer } from '../../shared/mobile-relay-pairing-offer'
import { encodeMobilePairingQr } from './mobile-pairing-qr'

// Why: pairing URLs are ASCII and mixed-case, so the encoder always lands in QR
// byte mode, where version 40 at error-correction level M holds exactly 2331
// bytes. Pinning that number is what makes the boundary identical on every
// machine — discovering it at runtime only re-measures whatever the encoder
// currently does, so a capacity regression reads as a new boundary, not a failure.
const QR_BYTE_CAPACITY_AT_ECC_M = 2331

// Why: the offer schema rejects invite expiries outside a 10-minute window and
// re-checks it against the wall clock on every parse, so a frozen clock is what
// keeps the relay fixture both constructible and byte-identical across runs.
const FROZEN_NOW = Date.UTC(2026, 0, 1)
const INVITE_EXPIRES_AT = FROZEN_NOW + 5 * 60_000

function pairingUrl(endpointPadding: number, relay: boolean): string {
  const offer: PairingOffer = {
    v: 2,
    endpoint: `wss://pair.example/${'a'.repeat(endpointPadding)}`,
    deviceToken: 'd'.repeat(43),
    publicKeyB64: Buffer.alloc(32, 7).toString('base64'),
    scope: 'mobile',
    ...(relay
      ? {
          relay: {
            v: 1,
            directorUrl: 'https://director.example',
            cellUrl: 'https://cell.example',
            assignmentEpoch: 1,
            relayHostId: 'a'.repeat(16),
            inviteToken: 'b'.repeat(43),
            inviteExpiresAt: INVITE_EXPIRES_AT,
            e2eeFraming: 2
          }
        }
      : {})
  }
  return encodePairingOffer(offer)
}

// Base64 grows the URL by one or two bytes per padding character, so one length
// in four is unreachable. Throw rather than silently probe an adjacent length.
function pairingUrlOfExactByteLength(byteLength: number, relay: boolean): string {
  for (let endpointPadding = 0; endpointPadding <= byteLength; endpointPadding += 1) {
    const url = pairingUrl(endpointPadding, relay)
    const size = Buffer.byteLength(url)
    if (size === byteLength) {
      return url
    }
    if (size > byteLength) {
      break
    }
  }
  throw new Error(
    `no ${relay ? 'relay' : 'direct'} pairing offer encodes to exactly ${byteLength} bytes`
  )
}

describe('encodeMobilePairingQr', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  it.each([
    ['direct', false],
    ['relay', true]
  ] as const)(
    'uses the real encoder at the adjacent %s-offer capacity boundary',
    async (_, relay) => {
      const atCapacity = pairingUrlOfExactByteLength(QR_BYTE_CAPACITY_AT_ECC_M, relay)
      const overCapacity = pairingUrlOfExactByteLength(QR_BYTE_CAPACITY_AT_ECC_M + 1, relay)

      await expect(encodeMobilePairingQr(atCapacity)).resolves.toMatchObject({ ok: true })
      await expect(encodeMobilePairingQr(overCapacity)).resolves.toEqual({
        ok: false,
        reason: 'encoding_failed'
      })
    }
  )
})
