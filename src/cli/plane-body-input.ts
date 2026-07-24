import { isAbsolute, join } from 'node:path'
import { RuntimeClientError } from './runtime-client'
import { getRequiredStringFlag, getRequiredStringFlagAllowingEmpty } from './flags'
import {
  NodeReadableTextTooLargeError,
  readNodeReadableTextWithinLimit
} from '../shared/node-readable-text'
import {
  NodeFileReadTooLargeError,
  readNodeFileWithinLimit
} from '../shared/node-bounded-file-reader'

// Shared --body / --body-file reader for Plane writes (create, save-issue,
// comment add). Split from plane-request-builders.ts so both stay under the
// per-file line cap; re-exported there for the existing import sites.
const PLANE_WRITE_BODY_CAP = 50_000
const PLANE_WRITE_BODY_MAX_BYTES = PLANE_WRITE_BODY_CAP * 4

export function readPlaneBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: { required: true }
): Promise<string>
export function readPlaneBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: { required: false }
): Promise<string | undefined>
export async function readPlaneBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: { required: boolean }
): Promise<string | undefined> {
  const hasBody = flags.has('body')
  const hasBodyFile = flags.has('body-file')
  if (hasBody && hasBodyFile) {
    throw new RuntimeClientError('invalid_argument', 'Use either --body or --body-file, not both')
  }
  if (!hasBody && !hasBodyFile) {
    if (options.required) {
      throw new RuntimeClientError('invalid_argument', 'Missing --body or --body-file')
    }
    return undefined
  }
  const body = hasBody
    ? getRequiredStringFlagAllowingEmpty(flags, 'body')
    : await readPlaneBodyFile(getRequiredStringFlag(flags, 'body-file'), cwd)
  if (body.length > PLANE_WRITE_BODY_CAP) {
    throw planeBodyTooLargeError()
  }
  return body
}

async function readPlaneBodyFile(path: string, cwd: string): Promise<string> {
  if (path !== '-') {
    try {
      const { buffer } = await readNodeFileWithinLimit(
        isAbsolute(path) ? path : join(cwd, path),
        PLANE_WRITE_BODY_MAX_BYTES
      )
      return buffer.toString('utf8')
    } catch (error) {
      if (error instanceof NodeFileReadTooLargeError) {
        throw planeBodyTooLargeError()
      }
      throw error
    }
  }
  if (process.stdin.isTTY) {
    throw new RuntimeClientError('invalid_argument', 'stdin body requested but stdin is a TTY')
  }
  try {
    return await readNodeReadableTextWithinLimit(process.stdin, PLANE_WRITE_BODY_MAX_BYTES)
  } catch (error) {
    if (error instanceof NodeReadableTextTooLargeError) {
      throw planeBodyTooLargeError()
    }
    throw error
  }
}

function planeBodyTooLargeError(): RuntimeClientError {
  return new RuntimeClientError(
    'plane_body_too_large',
    `Plane body must be at most ${PLANE_WRITE_BODY_CAP} characters`
  )
}
