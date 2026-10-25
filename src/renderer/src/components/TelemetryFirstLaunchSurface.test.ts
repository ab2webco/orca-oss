// The surface mounts the banner only once the build's transport gate is known, so neither
// build shows the other's copy for a frame (ORCA-789).

import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/global-settings-types'

vi.mock('../lib/telemetry', () => ({
  getTransmitsInBuild: vi.fn<() => Promise<boolean>>()
}))

import { shouldShowFirstLaunchBanner } from './TelemetryFirstLaunchSurface'

function buildSettings(
  telemetry: Partial<NonNullable<GlobalSettings['telemetry']>> | undefined
): GlobalSettings {
  return {
    telemetry: telemetry && {
      installId: 'test-install-id',
      existedBeforeTelemetryRelease: true,
      optedIn: null,
      ...telemetry
    }
  } as unknown as GlobalSettings
}

describe('shouldShowFirstLaunchBanner', () => {
  it('shows nothing while the transport gate is unresolved', () => {
    expect(shouldShowFirstLaunchBanner(buildSettings({}), null)).toBe(false)
  })

  it.each([true, false])('shows the banner to an undecided existing user (transmits=%s)', (t) => {
    expect(shouldShowFirstLaunchBanner(buildSettings({}), t)).toBe(true)
  })

  it('shows nothing once the existing user has decided', () => {
    expect(shouldShowFirstLaunchBanner(buildSettings({ optedIn: false }), false)).toBe(false)
    expect(shouldShowFirstLaunchBanner(buildSettings({ optedIn: true }), true)).toBe(false)
  })

  it('shows nothing to a new user or a missing telemetry block', () => {
    expect(
      shouldShowFirstLaunchBanner(buildSettings({ existedBeforeTelemetryRelease: false }), false)
    ).toBe(false)
    expect(shouldShowFirstLaunchBanner(buildSettings(undefined), false)).toBe(false)
    expect(shouldShowFirstLaunchBanner(null, false)).toBe(false)
  })
})
