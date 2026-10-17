import type { GameMemberAdvisor, GameMemberAdvisorPick } from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import { gameStrings } from './game-strings'

// What a member card says about the model and effort Jev has that member on.

const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const pickOf = (value: Record<string, unknown>): GameMemberAdvisorPick => ({
  model: textOrNull(value.model),
  effort: textOrNull(value.effort)
})

export const memberAdvisorOf = (value: unknown): GameMemberAdvisor | undefined => {
  if (!isShape(value) || (value.model !== null && typeof value.model !== 'string')) {
    return undefined
  }
  const pinned = isShape(value.pinned) ? value.pinned : {}
  return {
    ...pickOf(value),
    pinned: { model: pinned.model === true, effort: pinned.effort === true },
    ...(isShape(value.previous) ? { previous: pickOf(value.previous) } : {})
  }
}

const pickText = (pick: GameMemberAdvisorPick): string =>
  [pick.model ?? '', pick.effort ?? ''].filter((one) => one !== '').join('·')

/** The card's Jev row cut to `room` cells: the pin goes first, then Jev's name, then the switch. */
export const memberAdvisorTextOf = (advisor: GameMemberAdvisor, room: number): string | null => {
  const now = pickText(advisor)
  if (now === '') {
    return null
  }
  const before = advisor.previous === undefined ? '' : pickText(advisor.previous)
  const pins = gameStrings().text.advisorPinned(advisor.pinned)
  const moved = before === '' ? now : `${before} → ${now}`
  const pinned = pins === '' ? '' : ` · ${pins}`
  const tries = [
    `◆ Jev ${moved}${pinned}`,
    `◆ Jev ${moved}`,
    `◆ ${moved}`,
    `◆ ${now}${pinned}`,
    `◆ ${now}`
  ]
  return tries.find((one) => cellWidthOf(one) <= room) ?? fitCells(`◆ ${now}`, room)
}

/** "◆ 2 on Sonnet 5.5, 1 on Opus 5.5" for the members whose Jev names a model; null for none. */
export const fleetAdvisorSummaryOf = (
  agents: readonly { advisor?: GameMemberAdvisor }[]
): string | null => {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const model = agent.advisor?.model
    if (model !== undefined && model !== null && model !== '') {
      counts.set(model, (counts.get(model) ?? 0) + 1)
    }
  }
  if (counts.size === 0) {
    return null
  }
  const on = gameStrings().text.membersOn
  const groups = [...counts].sort((a, b) => b[1] - a[1]).map(([model, count]) => on(count, model))
  return `◆ ${groups.join(', ')}`
}
