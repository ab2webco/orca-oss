import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'

const isCode = (error: unknown, code: string): boolean =>
  error instanceof OrchestrationError && error.code === code

/** Whether the host proves nothing of the member remains: no attachment, or no terminal and no worktree it created. */
export async function isFederatedMemberGoneOnHost(
  runtime: OrcaRuntimeService,
  environmentId: string,
  dispatchId: string
): Promise<boolean> {
  let shown: {
    attachment: { effects: { kind?: string; action?: string; id?: string }[] }
    observation: { status: string }
  }
  try {
    shown = (await runtime.callOrchestrationWorkerServer(
      environmentId,
      'orchestration.federationShow',
      { dispatchId },
      15_000
    )) as typeof shown
  } catch (error) {
    if (isCode(error, 'dispatch_not_found')) {
      return true
    }
    throw error
  }
  if (!['missing', 'unattached'].includes(shown.observation.status)) {
    return false
  }
  const created = shown.attachment.effects.find(
    (effect) => effect.kind === 'worktree' && effect.action?.startsWith('created') && effect.id
  )
  if (!created?.id) {
    return true
  }
  try {
    await runtime.callOrchestrationWorkerServer(
      environmentId,
      'worktree.show',
      { worktree: `id:${created.id}` },
      15_000
    )
    return false
  } catch (error) {
    if (isCode(error, 'selector_not_found')) {
      return true
    }
    throw error
  }
}

export function isHostDispatchNotFound(error: unknown): boolean {
  return isCode(error, 'dispatch_not_found')
}
