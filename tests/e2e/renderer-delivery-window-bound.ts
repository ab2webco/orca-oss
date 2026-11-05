import { expect } from '@stablyai/playwright-test'
import { PTY_RENDERER_MAX_IN_FLIGHT_CHARS } from '../../src/shared/pty-renderer-delivery-window'

// Why main's window, not a fixed queue size: the renderer ACKs only what its scheduler consumed, so
// queued chars are part of main's in-flight; how much of it is still queued is runner speed (ORCA-1061).
export function expectRendererDeliveryWithinWindow(
  scheduler: { peakQueuedChars: number } | null,
  mainPressure: { peakRendererInFlightChars: number } | null
): void {
  expect(scheduler?.peakQueuedChars ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    PTY_RENDERER_MAX_IN_FLIGHT_CHARS
  )
  expect(mainPressure?.peakRendererInFlightChars ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    PTY_RENDERER_MAX_IN_FLIGHT_CHARS
  )
}
