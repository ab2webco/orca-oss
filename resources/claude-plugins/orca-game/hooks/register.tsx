import type { Register } from 'claude-code'

import { registerActionCommands } from './action-commands'
import { actOutGate, registerAdvisor } from './advisor-sync'
import { clearAllies, registerAllies } from './allies-strip'
import { registerBand } from './band'
import { registerFleetPane } from './fleet-pane'
import { POLL_EVERY_MS, refreshSoon } from './fleet-sync'
import { questSessionStart, registerQuest } from './quest'
import { leadAutostart } from './lead-autostart'
import { registerStateCommand } from './state-command'
import { registerLeadName, syncLeadName } from './lead-name'
import { isHumanOrigin } from './quest-policy'
import { clawdReact } from './quest-runtime'
import { markLeadStarted } from './lead-autostart'
import { isSubagentTool, isTeammateSpawnOf, leadSubagentDenyOf } from './lead-subagent-guard'
import { isGameLeadCommand, isLeadStarted } from './lead-started'
import { noteSubagentCall, noteSubagentDone, runningLeadSubagents } from './lead-subagents'
import { viewOf } from './fleet-sync'
import { questToolCall, questTurnComplete } from './quest-turns'

export const register: Register = (on) => {
  registerQuest(on)
  registerBand(on)
  registerAllies(on)
  registerAdvisor(on)
  registerFleetPane(on)
  registerLeadName(on)
  registerActionCommands(on)
  registerStateCommand(on)

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
    } else {
      noteSubagentDone(runningLeadSubagents, e.agentId)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    questToolCall(String(e.tool), e, e.agentId)
    if (e.agentId !== undefined) {
      noteSubagentCall(runningLeadSubagents, e.agentId, String(e.tool), await $.clock.now())
    } else if (String(e.tool) === 'Bash') {
      const command: unknown = Reflect.get(e, 'command')
      if (isGameLeadCommand(command)) {
        await markLeadStarted($).catch(() => undefined)
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
      clawdReact($, 'hello')
    }
    return next(e)
  })
}
