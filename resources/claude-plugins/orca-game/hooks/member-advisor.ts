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

const fitted = (tries: readonly string[], room: number): string =>
  tries.find((one) => cellWidthOf(one) <= room) ?? fitCells(tries.at(-1) ?? '', room)

// Why only what changed: "Opus 5.5 → Sonnet 5.5" reads at a glance where the full pair would not fit.
const switchOf = (before: GameMemberAdvisorPick, now: GameMemberAdvisorPick): string => {
  const isModelSame = before.model === now.model
  const isEffortSame = before.effort === now.effort
  if (isModelSame && isEffortSame) {
    return ''
  }
  const side = (pick: GameMemberAdvisorPick) =>
    isModelSame ? (pick.effort ?? '') : isEffortSame ? (pick.model ?? '') : pickText(pick)
  return `↳ ${side(before) || '?'} → ${side(now) || '?'}`
}

/** The card's Jev rows cut to `room` cells: Jev's name goes first, then the pin, never the model. */
export const memberAdvisorLinesOf = (advisor: GameMemberAdvisor, room: number): string[] => {
  const now = pickText(advisor)
  if (now === '') {
    return []
  }
  const pins = gameStrings().text.advisorPinned(advisor.pinned)
  const pinned = pins === '' ? '' : ` · ${pins}`
  const head = fitted([`◆ Jev ${now}${pinned}`, `◆ ${now}${pinned}`, `◆ ${now}`], room)
  const moved = advisor.previous === undefined ? '' : switchOf(advisor.previous, advisor)
  return moved === '' ? [head] : [head, fitCells(moved, room)]
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
