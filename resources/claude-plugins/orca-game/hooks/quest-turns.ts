import { actionOf, activityOf, isFinishingCall, phaseOf } from './quest-policy'
import { quest } from './quest-runtime'

// What the lead's own tool calls and finished turns do to the scene: its phase, prop and caption.

export function questToolCall(tool: string, input: unknown, agentId: string | undefined): void {
  if (agentId !== undefined) {
    return
  }
  quest.phase = phaseOf(tool, input) ?? quest.phase
  if (isFinishingCall(tool, input)) {
    quest.isDone = true
  }
  quest.action = actionOf(tool, input) ?? quest.action
  const said = activityOf(tool, input)
  if (said !== quest.caption) {
    quest.captionAt = quest.tick
  }
  quest.caption = said
}

export function questTurnComplete(agentId: string | undefined): void {
  if (agentId !== undefined) {
    return
  }
  quest.caption = ''
  quest.action = undefined
}
