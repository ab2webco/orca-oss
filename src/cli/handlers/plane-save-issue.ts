import type { PlaneMutationResult } from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { throwOnPlaneMutationFailure } from '../plane-request-builders'
import { buildPlaneSaveIssueRequest } from '../plane-save-issue-request'

const PLANE_WRITE_TIMEOUT_MS = 75_000

export const runPlaneSaveIssue: CommandHandler = async ({ flags, client, cwd, json }) => {
  const request = await buildPlaneSaveIssueRequest(flags, client, cwd)
  const response = await client.call<PlaneMutationResult>('plane.updateWorkItem', request, {
    timeoutMs: PLANE_WRITE_TIMEOUT_MS
  })
  throwOnPlaneMutationFailure(response.result)
  printResult(response, json, () => `Saved ${request.workItemId}.`)
}
