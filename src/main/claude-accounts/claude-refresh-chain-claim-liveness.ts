import { claudeRefreshInstancePath } from './claude-refresh-chain-lease-paths'
import {
  readClaudeRefreshChainLeaseRecord,
  type ClaudeRefreshChainLeaseRecord
} from './claude-refresh-chain-lease-record'

export type ClaudeRefreshChainClaimLivenessContext = {
  rootPath: string
  now: () => number
  processIsAlive: (processId: number) => boolean | null
}

/**
 * Whether a claim's owner is provably gone, so reaping it cannot orphan a live session.
 *
 * Why a pid alone is not enough: pids get reused, so a recycled pid would make a dead owner look
 * alive. The instance record pins identity — a different instanceId under the same pid means the
 * original owner is gone.
 *
 * Why "provably": an inconclusive answer (no instance record, or a pid we cannot inspect) must
 * read as alive here. Reaping on doubt is what strands a running CLI.
 */
export function isClaudeRefreshChainClaimProvablyDead(
  record: ClaudeRefreshChainLeaseRecord,
  context: ClaudeRefreshChainClaimLivenessContext
): boolean {
  if (record.expiresAt <= context.now()) {
    return true
  }
  if (context.processIsAlive(record.processId) === false) {
    return true
  }
  const instance = readClaudeRefreshChainLeaseRecord(
    claudeRefreshInstancePath(context.rootPath, record.processId)
  )
  return instance !== null && instance.instanceId !== record.instanceId
}

/**
 * Whether a claim is positively owned by a live instance.
 *
 * Why this is not the negation of provably-dead: this one demands proof of life, so an
 * unverifiable owner answers false. The two exist because the safe default flips with the
 * question — reaping needs proof of death, honoring a claim needs proof of life.
 */
export function isClaudeRefreshChainClaimOwnerValid(
  record: ClaudeRefreshChainLeaseRecord,
  context: ClaudeRefreshChainClaimLivenessContext
): boolean {
  if (record.expiresAt <= context.now() || context.processIsAlive(record.processId) !== true) {
    return false
  }
  const instance = readClaudeRefreshChainLeaseRecord(
    claudeRefreshInstancePath(context.rootPath, record.processId)
  )
  return (
    instance?.instanceId === record.instanceId &&
    instance.instanceStartedAt === record.instanceStartedAt
  )
}
