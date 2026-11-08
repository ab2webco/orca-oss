import type React from 'react'
import { translate } from '@/i18n/i18n'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'

/** The project's level and XP bar under its name, as V28 draws it; from the characters' real XP. */
export function TeamXpRow({
  xp
}: {
  xp: NonNullable<TeamPanelGameModel['xp']>
}): React.JSX.Element {
  const ratio = xp.need > 0 ? Math.min(1, xp.into / xp.need) : 0
  return (
    <div
      data-team-xp=""
      className="flex items-center gap-2 px-3 pb-1.5 text-xs tabular-nums text-muted-foreground"
    >
      <span>{translate('teamPanel.xp.level', 'Lv {{level}}', { level: xp.level })}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full origin-left bg-foreground/60"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </span>
      <span>
        {translate('teamPanel.xp.progress', '{{into}}/{{need}} XP', {
          into: xp.into,
          need: xp.need
        })}
      </span>
    </div>
  )
}
