import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TelemetryConsentState } from '../../../../shared/telemetry-consent-types'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import {
  PRIVACY_URL,
  getConsentState,
  getTransmitsInBuild,
  setOptIn as telemetrySetOptIn
} from '../../lib/telemetry'
import { useAppStore } from '../../store'
import { PrivacyDiagnosticsSection } from './PrivacyDiagnosticsSection'
import { translate } from '@/i18n/i18n'

export type EnvBlockedReason = 'do_not_track' | 'orca_disabled' | 'ci'
export type BlockedReason = { kind: 'env'; reason: EnvBlockedReason }

type PrivacyPaneProps = {
  settings: GlobalSettings
}

const PRIVACY_PANE_BLOCKED_HELPER_ID = 'privacy-pane-blocked-helper'

export function isEnvBlocked(consent: TelemetryConsentState | null): consent is {
  effective: 'disabled'
  reason: EnvBlockedReason
} {
  return (
    consent?.effective === 'disabled' &&
    (consent.reason === 'do_not_track' ||
      consent.reason === 'orca_disabled' ||
      consent.reason === 'ci')
  )
}

export function envVarNameForReason(reason: EnvBlockedReason): string {
  if (reason === 'do_not_track') {
    return 'DO_NOT_TRACK'
  }
  if (reason === 'orca_disabled') {
    return 'ORCA_TELEMETRY_DISABLED'
  }
  return 'CI'
}

export function computeBlockedReason(consent: TelemetryConsentState | null): BlockedReason | null {
  if (isEnvBlocked(consent)) {
    return { kind: 'env', reason: consent.reason }
  }
  return null
}

export function PrivacyPane({ settings }: PrivacyPaneProps): React.JSX.Element {
  const [consent, setConsent] = useState<TelemetryConsentState | null>(null)
  const [transmitsInBuild, setTransmitsInBuild] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const mountedRef = useMountedRef()
  const fetchSettings = useAppStore((s) => s.fetchSettings)

  useEffect(() => {
    let stale = false
    void getConsentState().then((state) => {
      if (!stale) {
        setConsent(state)
      }
    })
    return () => {
      stale = true
    }
  }, [settings.telemetry?.optedIn])

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

  const blocked = computeBlockedReason(consent)
  const toggleChecked = settings.telemetry?.optedIn === true

  const handleToggle = async (): Promise<void> => {
    if (blocked || inFlight) {
      return
    }
    setInFlight(true)
    try {
      await telemetrySetOptIn(!toggleChecked)
      await fetchSettings()
    } finally {
      if (mountedRef.current) {
        setInFlight(false)
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            <Label>
              {translate(
                'auto.components.settings.PrivacyPane.fe904ac984',
                'Share anonymous usage data'
              )}
            </Label>
          </div>
          <PrivacyStatement transmitsInBuild={transmitsInBuild} />
        </div>
        <Switch
          checked={toggleChecked}
          aria-label={translate(
            'auto.components.settings.PrivacyPane.fe904ac984',
            'Share anonymous usage data'
          )}
          aria-describedby={blocked ? PRIVACY_PANE_BLOCKED_HELPER_ID : undefined}
          disabled={blocked !== null || inFlight}
          onCheckedChange={() => void handleToggle()}
        />
      </div>

      {blocked ? <BlockedHelper blocked={blocked} id={PRIVACY_PANE_BLOCKED_HELPER_ID} /> : null}
      <PrivacyDiagnosticsSection />
    </div>
  )
}

// The statement follows the transport gate, so a build that cannot send never claims it does.
export function PrivacyStatement({
  transmitsInBuild
}: {
  transmitsInBuild: boolean
}): React.JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      {transmitsInBuild
        ? translate(
            'auto.components.settings.PrivacyPane.8bfdd23a88',
            'Help us figure out what to build next. Orca Lab sends anonymous counts of which features you use and where things break.'
          )
        : translate(
            'auto.components.settings.PrivacyPane.79ec8b8ed2',
            'Orca Lab builds from this repository do not send telemetry. No usage counts leave this machine.'
          )}{' '}
      <button
        type="button"
        className="underline underline-offset-2 hover:text-foreground"
        onClick={() => void window.api.shell.openUrl(PRIVACY_URL)}
      >
        {translate('auto.components.settings.PrivacyPane.77410e0566', 'Privacy policy')}
      </button>
      .
    </p>
  )
}

function BlockedHelper({ blocked, id }: { blocked: BlockedReason; id: string }): React.JSX.Element {
  return (
    <div id={id} className="pb-2 text-xs text-muted-foreground">
      {blocked.reason === 'ci' ? (
        <p>
          {translate(
            'auto.components.settings.PrivacyPane.e3970bbbf5',
            'Telemetry is disabled because a CI environment variable is set. Unset it and restart.'
          )}
        </p>
      ) : (
        <p>
          {translate(
            'auto.components.settings.PrivacyPane.79a0f3c16c',
            'Telemetry is disabled by the'
          )}{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            {envVarNameForReason(blocked.reason)}
          </code>{' '}
          {translate(
            'auto.components.settings.PrivacyPane.36e0e2e63b',
            'environment variable. Unset it and restart to re-enable.'
          )}
        </p>
      )}
    </div>
  )
}
