import React, { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { RuntimePlaneSettings } from '@/runtime/runtime-plane-client'
import { planeRateLimitWait } from '@/runtime/runtime-plane-rate-limit'
import type { PlaneRateLimitWait } from '../../../shared/plane-rate-limit-wait'

const POLL_MS = 1_000

/** Names what a loading Plane read waits on (rate limit or a 429 retry) instead of a bare spinner. */
export function TaskPagePlaneRateLimitNotice({
  settings
}: {
  settings: RuntimePlaneSettings
}): React.JSX.Element | null {
  const [wait, setWait] = useState<PlaneRateLimitWait | null>(null)
  useEffect(() => {
    let live = true
    const read = (): void => {
      void planeRateLimitWait(settings).then((next) => {
        if (live) {
          setWait(next)
        }
      })
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [settings])
  if (!wait) {
    return null
  }
  const seconds = Math.max(1, Math.ceil(wait.waitMs / 1000))
  // Why the no-break space before `s`: at 320 px the unit wrapped alone onto its own line.
  return (
    <p role="status" className="flex-none px-3 py-2 text-xs text-muted-foreground">
      {wait.reason === 'retry'
        ? translate(
            'auto.components.TaskPage.planeRateLimitRetrying',
            'Plane asked to slow down: retrying in {{value0}} s',
            { value0: seconds }
          )
        : translate(
            'auto.components.TaskPage.planeRateLimitWaiting',
            'Plane rate limit: waiting {{value0}} s',
            { value0: seconds }
          )}
    </p>
  )
}
