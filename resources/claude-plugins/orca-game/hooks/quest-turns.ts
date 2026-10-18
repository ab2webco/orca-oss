import { actionOf, activityOf, isFinishingCall, phaseOf } from './quest-policy'
import { quest } from './quest-runtime'

// What the lead's own tool calls and finished turns do to the scene: its phase, prop and caption.

export function questToolCall(tool: string, input: unknown, agentId: string | undefined): void {
  if (agentId !== undefined) {
    return
  }
  questLeadActive()
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

// Why: the next refresh can be 30 s away, and a lead running a tool is working now.
export function questLeadActive(): void {
  if (quest.leadState !== undefined) {
    quest.leadState = 'working'
  }
}

export function questTurnComplete(agentId: string | undefined): void {
  if (agentId !== undefined) {
    return
  }
  quest.caption = ''
  quest.action = undefined
}
