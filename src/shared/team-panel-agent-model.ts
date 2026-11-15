import type { GameMemberAdvisor } from './orchestrator-game-member-advisor'
import { gameMemberLaunchOf } from './orchestrator-game-member-launch'
import type { GameAgent } from './orchestrator-game-state'
import type { TeamModel, TeamModelCredit } from './team-panel-model-types'

const JEV_LINE_SEPARATOR = ' · '

/**
 * The router's reason on Jev's line (`jev · model: X · [effort ·] reason`); null for any other
 * line Jev draws, such as a gate verdict, so a card never shows one as a model choice.
 */
export function jevReasonOf(line: string | null | undefined, model: string): string | null {
  const segments = line?.split(JEV_LINE_SEPARATOR) ?? []
  if (segments.length < 3 || !segments[1]?.includes(model)) {
    return null
  }
  return segments.at(-1)?.trim() || null
}

const labelOf = (model: string | null | undefined): string | null =>
  model ? (gameMemberLaunchOf({ model, effort: null })?.model ?? null) : null

const jevCreditOf = (advisor: GameMemberAdvisor, served: string): TeamModelCredit => {
  const routed = labelOf(advisor.routedModel)
  const session = labelOf(advisor.sessionModel)
  return {
    by: 'jev',
    from: routed && session && session !== served ? session : null,
    // Why Jev's label: its line names the model it routed, which the transcript may not show yet.
    reason: jevReasonOf(advisor.line, advisor.model ?? served)
  }
}

/**
 * The model a card names: what the session served (its transcript), else what Jev reports, else
 * the launch choice, else `fallback`. Jev is credited only where its report exists (ORCA-851).
 */
export const teamAgentModelOf = (
  agent: Pick<GameAgent, 'advisor' | 'launch'>,
  fallback?: { model?: string; effort?: string }
): TeamModel | null => {
  const served = agent.launch?.source === 'session' && agent.launch.model ? agent.launch : null
  const { advisor } = agent
  if (advisor && (served?.model || advisor.model)) {
    const label = served?.model ?? advisor.model ?? ''
    return {
      label,
      effort: served ? served.effort : advisor.effort,
      source: served ? 'session' : 'advisor',
      credit: jevCreditOf(advisor, label)
    }
  }
  if (agent.launch?.model) {
    return {
      label: agent.launch.model,
      effort: agent.launch.effort,
      source: agent.launch.source ?? 'launch'
    }
  }
  return fallback?.model
    ? { label: fallback.model, effort: fallback.effort ?? null, source: 'launch' }
    : null
}
