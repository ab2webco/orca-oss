// Root-mounted gate for the existing-user first-launch notice. New users
// get NO first-launch surface — default-on with no first-run notice
// matches the category norm for developer tooling; see telemetry-plan.md
// §First-launch experience for the rationale.
//
// Cohort marker populated by the migration in `src/main/persistence.ts`:
//
//   - `existedBeforeTelemetryRelease === true && optedIn === null`
//       → FirstLaunchBanner (notice; no events transmit until the user
//         resolves it via ✕ or Turn off)
//   - otherwise → null (nothing to show)
//
// A local `dismissed` state hides the notice for the rest of the session
// after a button click — the store refresh after the IPC resolves also
// clears the cohort condition, but the optimistic flip removes a
// frame-lag flash where the notice briefly re-renders while settings
// round-trip through IPC.

import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { getTransmitsInBuild } from '../lib/telemetry'
import { useAppStore } from '../store'
import { FirstLaunchBanner } from './FirstLaunchBanner'

// Waits for the transport gate: rendering before it resolves would flash the other build's copy.
export function shouldShowFirstLaunchBanner(
  settings: GlobalSettings | null,
  transmitsInBuild: boolean | null
): boolean {
  const telemetry = settings?.telemetry
  if (!telemetry || transmitsInBuild === null) {
    // Defensive: migration guarantees the block exists. If it somehow
    // doesn't, show nothing rather than guessing a cohort wrong.
    return false
  }
  return telemetry.existedBeforeTelemetryRelease === true && telemetry.optedIn === null
}

export function TelemetryFirstLaunchSurface(): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  // Main's `telemetry:setOptIn` / `telemetry:acknowledgeBanner` handlers
  // intentionally do NOT broadcast `settings:changed`, so the notice
  // must call `fetchSettings()` itself after its IPC writes to keep the
  // renderer store (and PrivacyPane) from rendering stale telemetry
  // state. See PrivacyPane.tsx for the identical pattern.
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const [dismissedThisSession, setDismissedThisSession] = useState(false)
  const [transmitsInBuild, setTransmitsInBuild] = useState<boolean | null>(null)

  useEffect(() => {
    let stale = false
    void getTransmitsInBuild().then((value) => {
      if (!stale) {
        setTransmitsInBuild(value)
      }
    })
    return () => {
      stale = true
    }
  }, [])

  if (
    dismissedThisSession ||
    transmitsInBuild === null ||
    !shouldShowFirstLaunchBanner(settings, transmitsInBuild)
  ) {
    return null
  }

  return (
    <FirstLaunchBanner
      transmitsInBuild={transmitsInBuild}
      fetchSettings={fetchSettings}
      onResolve={() => setDismissedThisSession(true)}
    />
  )
}
