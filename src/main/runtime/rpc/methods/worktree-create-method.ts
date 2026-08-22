import { settleAutomationWorkspaceProvenanceRequestOnFailure } from '../../../automations/settle-workspace-provenance-on-failure'
import {
  finishAutomationWorkspaceProvenanceRequest,
  resolveAutomationWorkspaceProvenance
} from '../../../automations/workspace-provenance'
import { buildCliWorkspaceProvenance } from '../../../../shared/cli-workspace-provenance'
import { defineMethod, type RpcMethod } from '../core'
import { resolveRpcWorkspaceCreatorProvenance } from '../workspace-creator-context'
import { WorktreeCreate } from './worktree-schemas'

// Split out of worktree.ts: create carries the whole provenance/dedupe path and is
// most of that file on its own.
export const WORKTREE_CREATE_METHOD: RpcMethod = defineMethod({
  name: 'worktree.create',
  params: WorktreeCreate,
  handler: async (params, context) =>
    // Why: a mobile create interrupted by a connection migration is retried with
    // the same clientMutationId; dedupe so the host returns the in-flight/created
    // worktree instead of spawning a duplicate. No key (desktop/CLI) runs plainly.
    context.runtime.dedupeWorktreeCreate(params.repo, params.clientMutationId, async () => {
      const { runtime } = context
      const repo = await runtime.showRepo(params.repo)
      const automationProvenance = resolveAutomationWorkspaceProvenance({
        authority: runtime,
        repoSelector: params.repo,
        repo,
        request: params.automationProvenanceRequest
      })
      // Why: provenance tokens are reserved before creation so retries can recover,
      // but failed create attempts must release the reservation for a safe retry.
      try {
        const result = await runtime.createManagedWorktree({
          repoSelector: params.repo,
          name: params.name ?? '',
          baseBranch: params.baseBranch,
          compareBaseRef: params.compareBaseRef,
          branchNameOverride: params.branchNameOverride,
          linkedIssue: params.linkedIssue,
          linkedPR: params.linkedPR,
          linkedLinearIssue: params.linkedLinearIssue,
          linkedLinearIssueWorkspaceId: params.linkedLinearIssueWorkspaceId,
          linkedLinearIssueOrganizationUrlKey: params.linkedLinearIssueOrganizationUrlKey,
          linkedPlaneWorkItem: params.linkedPlaneWorkItem,
          linkedGitLabMR: params.linkedGitLabMR,
          linkedGitLabIssue: params.linkedGitLabIssue,
          linkedBitbucketPR: params.linkedBitbucketPR,
          linkedAzureDevOpsPR: params.linkedAzureDevOpsPR,
          linkedGiteaPR: params.linkedGiteaPR,
          linkedWorkItem: params.linkedWorkItem,
          linkedTaskSourceContext: params.linkedTaskSourceContext,
          comment: params.comment,
          displayName: params.displayName,
          telemetrySource: params.telemetrySource,
          workspaceStatus: params.workspaceStatus,
          claudeAccountId: params.claudeAccountId,
          codexAccountId: params.codexAccountId,
          manualOrder: params.manualOrder,
          sparseCheckout: params.sparseCheckout,
          pushTarget: params.pushTarget,
          runHooks: params.runHooks === true,
          activate: params.activate === true,
          setupDecision: params.setupDecision,
          createdWithAgent: params.createdWithAgent ?? params.startupAgent,
          automationProvenance,
          cliProvenance: buildCliWorkspaceProvenance(params.cliProvenanceRequest, {
            startupAgent: params.startupAgent ?? params.createdWithAgent,
            createdAt: Date.now()
          }),
          creatorProvenance: resolveRpcWorkspaceCreatorProvenance(context),
          startup: params.startupCommand
            ? {
                command: params.startupCommand,
                ...(params.startupEnv ? { env: params.startupEnv } : {}),
                ...(params.startupLaunchConfig ? { launchConfig: params.startupLaunchConfig } : {}),
                ...(params.startupCommandDelivery
                  ? { startupCommandDelivery: params.startupCommandDelivery }
                  : {})
              }
            : undefined,
          ...(params.startupAgent ? { startupAgent: params.startupAgent } : {}),
          ...(params.startupPrompt !== undefined ? { startupPrompt: params.startupPrompt } : {}),
          startupDraft: params.startupDraft,
          lineage: {
            parentWorkspace: params.parentWorkspace,
            envParentWorkspace: params.envParentWorkspace,
            parentWorktree: params.parentWorktree,
            ...(params.cwdParentWorktree ? { cwdParentWorktree: params.cwdParentWorktree } : {}),
            noParent: params.noParent === true,
            callerTerminalHandle: params.callerTerminalHandle,
            orchestrationContext: params.orchestrationContext
          }
        })
        finishAutomationWorkspaceProvenanceRequest(params.automationProvenanceRequest)
        // Why: agent callers need a stable dispatch target without traversing
        // terminal-list layout duplicates after creating the worktree.
        return params.startupAgent && result.startupTerminal?.handle
          ? { ...result, agentTerminalHandle: result.startupTerminal.handle }
          : result
      } catch (error) {
        settleAutomationWorkspaceProvenanceRequestOnFailure(
          params.automationProvenanceRequest,
          error
        )
        throw error
      }
    })
})
