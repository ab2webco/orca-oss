import type {
  PlaneCreateIntakeIssueResult,
  PlaneIntakeIssue,
  PlaneSetIntakeEnabledResult
} from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import {
  formatPlaneIntakeCreated,
  formatPlaneIntakeEnabled,
  formatPlaneIntakeList
} from '../plane-intake-format'
import {
  getPlanePriorityFlag,
  readPlaneBody,
  rejectAllWorkspaceForPlaneWrite
} from '../plane-request-builders'
import { RuntimeClientError } from '../runtime-client'

const PLANE_WRITE_TIMEOUT_MS = 75_000

const setIntakeEnabled: (
  context: Parameters<CommandHandler>[0],
  enabled: boolean
) => Promise<void> = async ({ flags, client, json }, enabled) => {
  rejectAllWorkspaceForPlaneWrite(flags)
  const response = await client.call<PlaneSetIntakeEnabledResult>(
    'plane.setIntakeEnabled',
    {
      projectId: getRequiredStringFlag(flags, 'project'),
      enabled,
      workspaceId: getOptionalStringFlag(flags, 'workspace')
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  if (!response.result.ok) {
    throw new RuntimeClientError('plane_write_failed', response.result.error)
  }
  printResult(
    { ...response, result: { enabled: response.result.enabled } },
    json,
    formatPlaneIntakeEnabled
  )
}

export const PLANE_INTAKE_HANDLERS: Record<string, CommandHandler> = {
  'plane intake create': async ({ flags, client, cwd, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const response = await client.call<PlaneCreateIntakeIssueResult>(
      'plane.createIntakeIssue',
      {
        projectId: getRequiredStringFlag(flags, 'project'),
        title: getRequiredStringFlag(flags, 'title'),
        workspaceId: getOptionalStringFlag(flags, 'workspace'),
        description: await readPlaneBody(flags, cwd, { required: false }),
        priority: flags.has('priority') ? getPlanePriorityFlag(flags, 'priority') : undefined
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    if (!response.result.ok) {
      throw new RuntimeClientError('plane_write_failed', response.result.error)
    }
    printResult(
      { ...response, result: response.result.intakeIssue },
      json,
      formatPlaneIntakeCreated
    )
  },
  'plane intake list': async ({ flags, client, json }) => {
    const response = await client.call<PlaneIntakeIssue[]>('plane.listIntakeIssues', {
      projectId: getRequiredStringFlag(flags, 'project'),
      workspaceId: getOptionalStringFlag(flags, 'workspace')
    })
    const limit = getOptionalPositiveIntegerFlag(flags, 'limit')
    const items = limit === undefined ? response.result : response.result.slice(0, limit)
    printResult({ ...response, result: items }, json, formatPlaneIntakeList)
  },
  'plane intake enable': async (context) => setIntakeEnabled(context, true),
  'plane intake disable': async (context) => setIntakeEnabled(context, false)
}
