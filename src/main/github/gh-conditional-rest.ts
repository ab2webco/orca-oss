/**
 * REST reads revalidated with ETags and shared by every concurrent caller (ORCA-1213).
 *
 * Why: GitHub does not bill a 304, so a poll of an unchanged resource is free; the
 * hourly cost then follows how often PRs change, not how many panels poll them.
 */
import { extractExecError } from '../git/exec-error'
import { ghExecFileAsync } from './gh-utils'

type GhOptions = Parameters<typeof ghExecFileAsync>[1]
type Validated = { etag: string; body: string }

const MAX_ENTRIES = 512
const validated = new Map<string, Validated>()
const inflight = new Map<string, Promise<string>>()

type IncludedResponse = {
  status: number | null
  etag: string | null
  body: string
}

// Why tolerate no status line: an old or wrapped gh may ignore --include and print the body alone.
function parseIncluded(stdout: string): IncludedResponse {
  if (!stdout.startsWith('HTTP/')) {
    return { status: null, etag: null, body: stdout }
  }
  const split = /\r?\n\r?\n/.exec(stdout)
  const head = split ? stdout.slice(0, split.index) : stdout
  return {
    status: Number(/^HTTP\/\S+\s+(\d{3})/.exec(head)?.[1]) || null,
    etag: /^etag:[ \t]*(.+?)[ \t]*\r?$/im.exec(head)?.[1] ?? null,
    body: split ? stdout.slice(split.index + split[0].length) : ''
  }
}

function remember(key: string, etag: string | null, body: string): void {
  validated.delete(key)
  if (!etag) {
    return
  }
  validated.set(key, { etag, body })
  if (validated.size > MAX_ENTRIES) {
    const oldest = validated.keys().next().value
    if (oldest !== undefined) {
      validated.delete(oldest)
    }
  }
}

async function revalidate(
  key: string,
  endpoint: string,
  options: GhOptions,
  known: Validated | undefined
): Promise<string> {
  const args = [
    'api',
    endpoint,
    '--include',
    ...(known ? ['--header', `If-None-Match: ${known.etag}`] : [])
  ]
  try {
    const { stdout } = await ghExecFileAsync(args, options)
    const response = parseIncluded(stdout)
    remember(key, response.etag, response.body)
    return response.body
  } catch (err) {
    // Why: gh exits non-zero on any status above 299, 304 included, with the headers still on stdout.
    if (known && parseIncluded(extractExecError(err).stdout).status === 304) {
      return known.body
    }
    throw err
  }
}

/**
 * The body of `gh api <endpoint>`, revalidated against the last one this scope saw.
 * `scope` must separate gh hosts and accounts so one cannot be served another's body.
 */
export function readGhRestConditionally(
  scope: string,
  endpoint: string,
  options: GhOptions = {}
): Promise<string> {
  const key = `${scope}\0${endpoint}`
  const pending = inflight.get(key)
  if (pending) {
    return pending
  }
  const request = revalidate(key, endpoint, options, validated.get(key)).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, request)
  return request
}

/** @internal - test-only */
export function _resetGhConditionalRestCache(): void {
  validated.clear()
  inflight.clear()
}
