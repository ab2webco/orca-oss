import type { Advisor } from './allies'

// What this pane tells Orca about its Jev, so a lead's Panel can show it on this member's card.

/** The CLI hands it to `game.state`; an older CLI ignores it, where an unknown flag could fail. */
export const ADVISOR_REPORT_ENV = 'ORCA_GAME_ADVISOR'

export type AdvisorPins = { model: boolean; effort: boolean }

/** Orca sets ORCA_AGENT_MODEL_PINNED / ORCA_AGENT_EFFORT_PINNED to 1 for a value it applied at launch. */
export const isPinnedValue = (value: string | null | undefined): boolean => value?.trim() === '1'

/** The report's JSON; `null` once Jev stops, so Orca forgets what it last said. */
export const advisorReportOf = (advisor: Advisor | null, pins: AdvisorPins): string =>
  JSON.stringify(
    advisor === null
      ? null
      : {
          version: 1,
          model: advisor.model,
          effort: advisor.effort === null ? null : String(advisor.effort),
          pinned: pins
        }
  )
