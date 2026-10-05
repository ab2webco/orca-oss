import { z } from 'zod'
import { AGENT_TYPE_MAX_LENGTH } from '../agent-status-types'
import type { PluginCapabilityKind } from './plugin-capabilities'
import type { PluginEventName } from './plugin-manifest'

/**
 * Payload contracts for the v0 plugin event set (worktree lifecycle, agent
 * status, and the notifications Orca decided to show). Payloads are bounded
 * projections — never raw runtime objects — so nothing sensitive (absolute
 * repo paths beyond the worktree's own, remotes, credentials) can leak through
 * the event stream.
 */

export const worktreeCreatedPayloadSchema = z.object({
  worktreeId: z.string().min(1).max(2048),
  path: z
    .string()
    .min(1)
    .max(32 * 1024),
  branch: z.string().max(1024)
})

export const worktreeRemovedPayloadSchema = z.object({
  worktreeId: z.string().min(1).max(2048),
  path: z
    .string()
    .min(1)
    .max(32 * 1024)
})

export const agentStatusChangedPayloadSchema = z.object({
  worktreeId: z.string().min(1).max(2048).nullable(),
  paneKey: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
  receivedAt: z.number().finite().positive(),
  agentType: z.string().min(1).max(AGENT_TYPE_MAX_LENGTH).optional(),
  // Why: a `done` that only marks a connect/resume/clear landing idle, not a finished turn.
  sessionBoundary: z.literal(true).optional()
})

export const NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH = 256
export const NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH = 1024

export const notificationDispatchedPayloadSchema = z.object({
  /** Orca's notification source, e.g. `agent-task-complete` or `terminal-bell`. */
  source: z
    .string()
    .min(1)
    .max(64)
    // Why: a plugin's own notifications.show must never echo into other plugins.
    .refine((source) => source !== 'plugin', 'plugin notifications are not re-emitted'),
  worktreeId: z.string().min(1).max(2048).nullable(),
  title: z.string().max(NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH),
  body: z.string().max(NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH),
  at: z.number().finite().positive()
})

export const PLUGIN_EVENT_PAYLOAD_SCHEMAS: Record<PluginEventName, z.ZodTypeAny> = {
  'worktree.created': worktreeCreatedPayloadSchema,
  'worktree.removed': worktreeRemovedPayloadSchema,
  'agent.status.changed': agentStatusChangedPayloadSchema,
  'notification.dispatched': notificationDispatchedPayloadSchema
}

/** Events whose payload carries user content need their own consented
 *  capability on top of `events:subscribe`. */
export const PLUGIN_EVENT_REQUIRED_CAPABILITY: Readonly<
  Partial<Record<PluginEventName, PluginCapabilityKind>>
> = {
  'notification.dispatched': 'notifications:observe'
}

/** Server-side gate for subscribing to and receiving an event. Deny-by-default:
 *  null (unknown, disabled, stale consent) grants nothing. */
export function isPluginEventGranted(
  grantedCapabilities: readonly PluginCapabilityKind[] | null,
  event: PluginEventName
): boolean {
  if (!grantedCapabilities?.includes('events:subscribe')) {
    return false
  }
  const required = PLUGIN_EVENT_REQUIRED_CAPABILITY[event]
  return required === undefined || grantedCapabilities.includes(required)
}

export type PluginWorktreeCreatedPayload = z.infer<typeof worktreeCreatedPayloadSchema>
export type PluginWorktreeRemovedPayload = z.infer<typeof worktreeRemovedPayloadSchema>
export type PluginAgentStatusChangedPayload = z.infer<typeof agentStatusChangedPayloadSchema>
export type PluginNotificationDispatchedPayload = z.infer<
  typeof notificationDispatchedPayloadSchema
>
