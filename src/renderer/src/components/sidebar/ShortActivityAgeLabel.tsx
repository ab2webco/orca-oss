import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useNow } from '../dashboard/useNow'
import { formatShortActivityAge } from './short-activity-age'

/** A row's right-aligned, muted age; renders nothing without a timestamp. */
export const ShortActivityAgeLabel = React.memo(function ShortActivityAgeLabel({
  since,
  className
}: {
  since: number | undefined
  className?: string
}): React.JSX.Element | null {
  // Why: memo props never change on a language switch, so it must subscribe to relabel.
  useTranslation()
  // Why 30 s: the shared clock the team rows already tick on, so every age updates in one commit.
  const now = useNow(30_000)
  const text = since === undefined ? null : formatShortActivityAge(since, now)
  if (text === null) {
    return null
  }
  return (
    <span
      data-activity-age=""
      className={cn(
        'shrink-0 text-[11px] leading-none tabular-nums text-muted-foreground',
        className
      )}
    >
      {text}
    </span>
  )
})
