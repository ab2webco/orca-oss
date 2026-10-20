import type { MessageType } from './types'

// Why: these only report progress; the replay contract protects mail a consumer must act on.
const INFORMATIONAL_TYPES: ReadonlySet<string> = new Set<MessageType>(['status', 'heartbeat'])

/** A typed wait may retire an unacknowledged batch that holds nothing it asked for and nothing actionable (ORCA-701). */
export function isBatchRetirableForWait(
  batch: readonly { type: string }[],
  wakeTypes: readonly string[]
): boolean {
  return batch.every(
    (message) => INFORMATIONAL_TYPES.has(message.type) && !wakeTypes.includes(message.type)
  )
}
