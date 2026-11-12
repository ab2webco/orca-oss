import type { Register } from 'claude-code'

import { registerActionCommands } from './action-commands'
import { dropAdvisorCall } from './advisor-state'
import { actOutGate, registerAdvisor } from './advisor-sync'
import { POLL_EVERY_MS, refreshSoon, viewOf } from './fleet-sync'
import { watchFleet } from './fleet-watch'
import { questSessionStart, registerQuest } from './quest'
import { markLeadStarted, startOrRearmLead, unmarkLeadStarted } from './lead-autostart'
import { registerLeadBrief } from './lead-brief'
import { registerStateCommand } from './state-command'
import { registerTextLayer } from './text-layer'
import { registerLayoutCommand } from './layout-command'
import { registerLeadName, syncLeadName } from './lead-name'
import { isHumanOrigin } from './quest-policy'
import { isSubagentTool, isTeammateSpawnOf, leadSubagentDenyOf } from './lead-subagent-guard'
import { isGameLeadCommand, isLeadStarted, isMadeLeadOutput } from './lead-started'
import { noteSubagentCall, noteSubagentDone, runningLeadSubagents } from './lead-subagents'
import { questLeadActive, questToolCall, questTurnComplete } from './quest-turns'
import { bumpLive, liveAsk, liveTurnEnd, liveTurnStart } from './live-turn'

export const register: Register = (on) => {
  registerQuest(on)
  registerTextLayer(on)
  registerAdvisor(on)
  registerLeadName(on)
  registerLeadBrief(on)
  registerActionCommands(on)
  registerStateCommand(on)
  registerLayoutCommand(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await questSessionStart($).catch(() => undefined)
    // Why the poll stays: PR and CI changes, paired hosts and an older Orca push nothing.
    $.clock.every(POLL_EVERY_MS, () => {
      void refreshSoon($).catch(() => undefined)
      void syncLeadName($).catch(() => undefined)
    })
    void watchFleet($, () => void refreshSoon($).catch(() => undefined)).catch(() => undefined)
    // Why not awaited: the skill runs once the session is idle, and session.start must not wait on it.
    void startOrRearmLead($).catch(() => undefined)
    return started
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      liveTurnStart(await $.clock.now())
      void bumpLive($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    questTurnComplete(e.agentId)
    if (e.agentId === undefined) {
      liveTurnEnd(e, await $.clock.now())
      void bumpLive($)
      if (dropAdvisorCall()) {
        $.ui.invalidate('ui.render')
      }
      void refreshSoon($).catch(() => undefined)
      void syncLeadName($).catch(() => undefined)
    } else {
      noteSubagentDone(runningLeadSubagents, e.agentId)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    questToolCall(String(e.tool), e, e.agentId)
    if (e.agentId === undefined && String(e.tool) === 'AskUserQuestion') {
      const close = liveAsk(e, await $.clock.now())
      void bumpLive($)
      try {
        return await next(e)
      } finally {
        close()
        void bumpLive($)
      }
    }
    if (e.agentId !== undefined) {
      noteSubagentCall(runningLeadSubagents, e.agentId, String(e.tool), await $.clock.now())
    } else if (String(e.tool) === 'Bash') {
      const command: unknown = Reflect.get(e, 'command')
      if (isGameLeadCommand(command)) {
        // Why after the call: only its output says whether this session or another pane leads.
        const answered = await next(e)
        await (isMadeLeadOutput(answered.result) ? markLeadStarted($) : unmarkLeadStarted($)).catch(
          () => undefined
        )
        return answered
      }
    }
    return next(e)
  })

  on('classic.PreToolUse', async ($, e, next) => {
    const tool = String(e.tool)
    if (!isSubagentTool(tool)) {
      const verdict = await next(e)
      actOutGate($, tool, Reflect.get(e, 'command'), verdict)
      return verdict
    }
    const { state } = await viewOf($)
    const reason = leadSubagentDenyOf({
      role: state?.role,
      isOrchestrator: await isLeadStarted($),
      tool,
      isTeammateSpawn: isTeammateSpawnOf(e),
      cli: (await $.env.get('ORCA_GAME_CLI').catch(() => undefined)) ?? 'orca'
    })
    return reason === null ? next(e) : { deny: reason }
  })

  on('prompt.submit', ($, e, next) => {
    if (isHumanOrigin(e.origin.kind)) {
      questLeadActive()
    }
    return next(e)
  })
}
