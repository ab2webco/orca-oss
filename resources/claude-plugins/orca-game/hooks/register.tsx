import type { Register } from 'claude-code'

import { registerActionCommands } from './action-commands'
import { registerAdvisor } from './advisor-sync'
import { clearAllies, registerAllies } from './allies-strip'
import { registerBand } from './band'
import { registerFleetPane } from './fleet-pane'
import { POLL_EVERY_MS, refreshSoon } from './fleet-sync'
import { questSessionStart, registerQuest } from './quest'
import { leadAutostart } from './lead-autostart'
import { registerLeadName, syncLeadName } from './lead-name'
import { isHumanOrigin } from './quest-policy'
import { clawdReact } from './quest-runtime'
import { questToolCall, questTurnComplete } from './quest-turns'

export const register: Register = (on) => {
  registerQuest(on)
  registerBand(on)
  registerAllies(on)
  registerAdvisor(on)
  registerFleetPane(on)
  registerLeadName(on)
  registerActionCommands(on)

  on('session.start', async ($, e, next) => {
    await clearAllies($)
    const started = await next(e)
    await questSessionStart($).catch(() => undefined)
    $.clock.every(POLL_EVERY_MS, () => {
      void refreshSoon($).catch(() => undefined)
      void syncLeadName($).catch(() => undefined)
    })
    // Why not awaited: the skill runs once the session is idle, and session.start must not wait on it.
    void leadAutostart($).catch(() => undefined)
    return started
  })

  on('turn.complete', ($, e, next) => {
    questTurnComplete(e.agentId)
    if (e.agentId === undefined) {
      void refreshSoon($).catch(() => undefined)
      void syncLeadName($).catch(() => undefined)
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
