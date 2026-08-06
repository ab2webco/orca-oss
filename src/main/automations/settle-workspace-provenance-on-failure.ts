import { isStartupAgentRefusedError } from '../runtime/startup-agent-refused-error'
import type { AutomationWorkspaceProvenanceRequest } from '../../shared/types'
import {
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest
} from './workspace-provenance'

/**
 * Settles an automation dispatch token when a workspace create throws.
 *
 * Why not always release: a create refused only at the agent launch DID create the
 * workspace, so its token is spent. Releasing it marks the token reusable and a retry
 * mints a second workspace under the same automation run (ORCA-190). Every other
 * failure created nothing and stays retryable.
 */
export function settleAutomationWorkspaceProvenanceRequestOnFailure(
  request: AutomationWorkspaceProvenanceRequest | undefined,
  error: unknown
): void {
  if (isStartupAgentRefusedError(error)) {
    finishAutomationWorkspaceProvenanceRequest(request)
    return
  }
  releaseAutomationWorkspaceProvenanceRequest(request)
}
