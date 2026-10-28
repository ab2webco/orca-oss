import { z } from 'zod'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'
import { inspectRemoteAttachment, requireHomeAttachment } from './orchestration-federation-control'
import type { FederationEffect } from './orchestration-federation-effects'

const SETTLED = ['succeeded', 'failed', 'stopped', 'abandoned']

export type FederationReleaseReceipt = {
  dispatchId: string
  state: 'released' | 'already_released' | 'retained'
  reason?: 'not_settled' | 'identity_unproven'
  closedTerminals: string[]
  removedWorktree: string | null
  worktreeError?: string
}

export const ORCHESTRATION_FEDERATION_RELEASE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.federationRelease',
    params: z.object({ dispatchId: requiredString('Missing Dispatch ID') }),
    handler: async (
      params,
      { runtime, authenticatedCallerFingerprint }
    ): Promise<FederationReleaseReceipt> => {
      const attachment = requireHomeAttachment(
        runtime,
        params.dispatchId,
        authenticatedCallerFingerprint
      )
      const receipt = {
        dispatchId: params.dispatchId,
        closedTerminals: [] as string[],
        removedWorktree: null as string | null
      }
      if (attachment.stage === 'released') {
        return { ...receipt, state: 'already_released' }
      }
      if (!SETTLED.includes(attachment.state)) {
        return { ...receipt, state: 'retained', reason: 'not_settled' }
      }
      const effects = JSON.parse(attachment.effects) as FederationEffect[]
      const agentEffect = effects.find(
        (effect) => effect.kind === 'terminal' && effect.id === attachment.terminal_handle
      )
      // Why: a terminal the lead handed in ('reused') belonged to someone before this dispatch.
      if (
        attachment.terminal_handle &&
        (agentEffect?.action === 'created' || agentEffect?.action === 'reused_agent_terminal')
      ) {
        const observation = await inspectRemoteAttachment(runtime, params.dispatchId)
        if (observation.status === 'identity_changed') {
          return { ...receipt, state: 'retained', reason: 'identity_unproven' }
        }
        if (observation.terminal) {
          await runtime.closeTerminal(attachment.terminal_handle)
          receipt.closedTerminals.push(attachment.terminal_handle)
        }
      }
      const created = effects.find(
        (effect) => effect.kind === 'worktree' && effect.action?.startsWith('created') && effect.id
      )
      let worktreeError: string | undefined
      if (created?.id) {
        try {
          // Why not force: a tree with changes stays for its owner; the branch survives removal.
          await runtime.removeManagedWorktree(`id:${created.id}`, false)
          receipt.removedWorktree = created.id
        } catch (error) {
          worktreeError = error instanceof Error ? error.message : String(error)
        }
      }
      runtime.getOrchestrationDb().markRemoteAttachmentReleased(params.dispatchId)
      return { ...receipt, state: 'released', ...(worktreeError ? { worktreeError } : {}) }
    }
  })
]

export function assertFederationReleaseReceipt(value: unknown): FederationReleaseReceipt {
  const receipt = value as FederationReleaseReceipt | null
  if (!receipt || !['released', 'already_released', 'retained'].includes(receipt.state)) {
    throw new OrchestrationError(
      'operation_unknown',
      'The worker server returned an unrecognized release receipt.'
    )
  }
  return receipt
}
