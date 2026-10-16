import type { Register } from 'claude-code'

import { registerAllies } from './allies-strip'
import { registerBand } from './band'
import { registerFleetPane } from './fleet-pane'
import { POLL_EVERY_MS, refreshSoon } from './fleet-sync'
import { questSessionStart, registerQuest } from './quest'
import { leadAutostart } from './lead-autostart'
import { isHumanOrigin } from './quest-policy'
import { clawdReact, questToolCall, questTurnComplete } from './quest-runtime'

export const register: Register = (on) => {
  registerQuest(on)
  registerBand(on)
  registerAllies(on)
  registerFleetPane(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await questSessionStart($).catch(() => undefined)
    $.clock.every(POLL_EVERY_MS, () => void refreshSoon($).catch(() => undefined))
    // Why not awaited: the skill runs once the session is idle, and session.start must not wait on it.
    void leadAutostart($).catch(() => undefined)
    return started
  })

  on('turn.complete', ($, e, next) => {
    questTurnComplete(e.agentId)
    if (e.agentId === undefined) {
      void refreshSoon($).catch(() => undefined)
    }
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    questToolCall(String(e.tool), e, e.agentId)
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (isHumanOrigin(e.origin.kind)) {
      clawdReact($, 'hello')
    }
    return next(e)
  })
}
