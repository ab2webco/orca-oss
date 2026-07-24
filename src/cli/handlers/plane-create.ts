import type { PlaneCreateWorkItemResult } from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { buildPlaneCreateRequest } from '../plane-create-request'
import { unwrapPlaneCreateMutation } from '../plane-request-builders'
import { formatPlaneCreate } from '../plane-format'

const PLANE_WRITE_TIMEOUT_MS = 75_000

export const runPlaneCreate: CommandHandler = async ({ flags, client, cwd, json }) => {
  const request = await buildPlaneCreateRequest(flags, client, cwd)
  const response = await client.call<PlaneCreateWorkItemResult>('plane.createWorkItem', request, {
    timeoutMs: PLANE_WRITE_TIMEOUT_MS
  })
  const created = unwrapPlaneCreateMutation(response.result)
  printResult({ ...response, result: created }, json, formatPlaneCreate)
}
