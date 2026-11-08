import { translate } from '@/i18n/i18n'
import type { TeamMemberCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'

export type TeamDisplayTickerLine = { text: string; alert: boolean }

const prLabelOf = (pr: NonNullable<TeamMemberCard['pr']>): string =>
  `${pr.provider === 'gitlab' ? '!' : '#'}${pr.number}`

const nameOf = (card: TeamMemberCard): string => card.ticket?.identifier ?? card.name

/** The line under Display's pages: who waits on you, then failing checks and the queue. */
export function teamDisplayTickerOf(model: TeamPanelGameModel): TeamDisplayTickerLine[] {
  const waiting = model.members.filter((card) => card.needsYou)
  if (waiting.length > 0) {
    return waiting.map((card) => ({
      text: translate('teamPanel.display.ticker.waiting', '{{name}} is waiting for you', {
        name: nameOf(card)
      }),
      alert: true
    }))
  }
  const lines: TeamDisplayTickerLine[] = model.members.flatMap((card) =>
    card.pr?.ci === 'failure'
      ? [
          {
            text: translate(
              'teamPanel.display.ticker.failing',
              '{{pr}} checks failing, {{name}} on it',
              {
                pr: prLabelOf(card.pr),
                name: nameOf(card)
              }
            ),
            alert: false
          }
        ]
      : []
  )
  const queue = model.queue?.kind === 'ready' ? model.queue.value : []
  const next = queue.find((entry) => entry.position === 1) ?? queue[0]
  if (next) {
    lines.push({
      text: translate('teamPanel.display.ticker.queue', 'Queue {{count}}, next {{pr}}', {
        count: queue.length,
        pr: next.label
      }),
      alert: false
    })
  }
  if (lines.length > 0) {
    return lines
  }
  const working = model.members.filter((card) => card.status === 'working').length
  return [
    {
      text: translate('teamPanel.display.ticker.working', '{{count}} working', { count: working }),
      alert: false
    }
  ]
}
