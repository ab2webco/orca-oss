import {
  detectAgentRateLimitOutput,
  type AgentRateLimitDetectionState,
  type AutoSwitchRateLimitAgent
} from '../../../shared/agent-rate-limit-detection'

export type AgentRateLimitDetectionGate = {
  detectionState: AgentRateLimitDetectionState
  suppressed: boolean
  suppressForResume(): void
  observePtyBoundary(): void
  resumeAfterAcceptedInput(): void
}

export function createAgentRateLimitDetectionGate(): AgentRateLimitDetectionGate {
  const gate: AgentRateLimitDetectionGate = {
    detectionState: { tail: '' },
    suppressed: false,
    suppressForResume() {
      gate.suppressed = true
      gate.detectionState.tail = ''
    },
    observePtyBoundary() {
      gate.detectionState.tail = ''
    },
    resumeAfterAcceptedInput() {
      gate.detectionState.tail = ''
      gate.suppressed = false
    }
  }
  return gate
}

export function observeAgentRateLimitOutput(args: {
  gate: AgentRateLimitDetectionGate
  agent: AutoSwitchRateLimitAgent
  data: string
  detected: () => void
}): void {
  if (
    !args.gate.suppressed &&
    detectAgentRateLimitOutput(args.agent, args.data, args.gate.detectionState)
  ) {
    args.detected()
  }
}
