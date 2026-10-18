import type { EngineInterface, On } from 'claude-code'

import { gateCueOf, type GateVerdict } from './advisor-cues'
import { logDecisions, observeAdvisor, playAdvisorCue } from './advisor-state'
import { refreshSoon } from './fleet-sync'
import { quest } from './quest-runtime'

export const registerAdvisor = (on: On): void => {
  // Why here and not only while drawing: a decision is logged once, the moment Jev writes it.
  on('state.set', { plugin: 'orca-jev-mod-skills', key: 'advisor' }, async ($, e, next) => {
    const written = await next(e)
    const decisions = observeAdvisor(e.value, quest.tick)
    // Why: a gesture that starts while the lead is idle needs the band to mount the scene.
    $.ui.invalidate('ui.render')
    await logDecisions($, decisions, await $.clock.now())
    // Why: a new main model or effort reaches the lead's Panel without waiting for the poll.
    if (decisions.some((one) => one.title === null)) {
      void refreshSoon($).catch(() => undefined)
    }
    return written
  })
}

/** Acts out the verdict Jev's gate (a settings hook beneath the game) returned for a tool call. */
export function actOutGate(
  $: EngineInterface,
  tool: string,
  command: unknown,
  verdict: GateVerdict
): void {
  const cue = gateCueOf(tool, command, verdict)
  if (cue !== undefined) {
    playAdvisorCue(cue, quest.tick)
    $.ui.invalidate('ui.render')
  }
}
