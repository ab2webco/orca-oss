import type { AgentGenerationFailureOutput } from '../text-generation/agent-failure-output'

const USAGE_LIMIT_PATTERN =
  /hit your (?:\w+ )?limit|usage limit|limit reached|rate.?limit|quota|\b429\b/i

/** True when a failed Claude generation run reports an exhausted account rather than a bad prompt or binary. */
export function isClaudeUsageLimitFailure(
  error: string,
  failureOutput: AgentGenerationFailureOutput | null | undefined
): boolean {
  return [error, failureOutput?.stdout ?? '', failureOutput?.stderr ?? ''].some((text) =>
    USAGE_LIMIT_PATTERN.test(text)
  )
}
