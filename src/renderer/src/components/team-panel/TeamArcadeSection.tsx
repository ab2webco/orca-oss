import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'

/** Spend one saved play (opening the Arcade tab) or keep it; both settle on the host. */
export type TeamArcadeActions = {
  play: () => Promise<void>
  keep: () => Promise<void>
}

type TeamArcade = NonNullable<TeamPanelGameModel['arcade']>

function savedText(count: number): string {
  return count === 1
    ? translate('teamPanel.arcade.savedOne', '1 saved play')
    : translate('teamPanel.arcade.savedMany', '{{count}} saved plays', { count })
}

/** Version 28's offer card and saved-play row: the offer first, the count once it is kept. */
export function TeamArcadeSection({
  arcade,
  actions
}: {
  arcade: TeamArcade
  actions: TeamArcadeActions
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  // Why busy: a second click before the host answers would spend a second play.
  const run = (action: () => Promise<void>) => async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  const play = (
    <Button size="xs" disabled={busy} onClick={run(actions.play)}>
      {translate('teamPanel.arcade.play', 'Play')}
    </Button>
  )
  if (arcade.offerPr !== null) {
    return (
      <section
        data-arcade-offer=""
        aria-label={translate('teamPanel.arcade.label', 'Arcade')}
        className="mx-3 my-2 flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5"
      >
        <span className="text-[13px] font-semibold">
          {translate('teamPanel.arcade.offerTitle', 'Perfect merge of #{{pr}}', {
            pr: arcade.offerPr
          })}
        </span>
        <p className="text-xs text-muted-foreground">
          {translate(
            'teamPanel.arcade.offerText',
            'You won a play. It stays saved until you want it.'
          )}
        </p>
        <span className="flex flex-wrap gap-1.5">
          {play}
          <Button size="xs" variant="secondary" disabled={busy} onClick={run(actions.keep)}>
            {translate('teamPanel.arcade.keep', 'Keep')}
          </Button>
        </span>
      </section>
    )
  }
  if (arcade.credits < 1) {
    return null
  }
  return (
    <div
      data-arcade-credits=""
      className="flex min-h-7 items-center gap-2 px-3 pt-2 text-xs text-muted-foreground"
    >
      <span className="tabular-nums">{savedText(arcade.credits)}</span>
      <span className="ml-auto">{play}</span>
    </div>
  )
}
