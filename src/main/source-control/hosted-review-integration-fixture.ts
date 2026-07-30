import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach } from 'vitest'
import { _resetOriginGitHubApiRepositoryCache } from '../github/github-api-repository'
import { _resetGitHubHostAuthCache } from '../github/github-enterprise-repository'

const execFileAsync = promisify(execFile)

// Why: forge detection probes GitHub before Bitbucket/Azure/Gitea, so every
// fixture remote spawns `gh auth status`. Bound it far below Vitest's 30s
// testTimeout — the runner's own 30s gh default can never fire first, so the
// test budget expires instead and kills the case before it cleans up (ORCA-119).
export const HOSTED_REVIEW_GH_PROBE_TIMEOUT_MS = 1_500

// Why: gh must answer from an empty config, not the host's real credentials, or
// a developer authenticated to a GHES host resolves a different provider.
const NEUTRALIZED_GH_ENV_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GH_HOST'
] as const

export type SeenRequest = {
  pathname: string
  search: string
  authorization: string | undefined
}

/** Return true once the route has answered; unmatched requests get a 404. */
export type HostedReviewFixtureRoute = (url: URL, res: ServerResponse) => boolean

export type HostedReviewFixture = {
  /** Requests the fixture server received, in order. */
  readonly seen: readonly SeenRequest[]
  /** `http://127.0.0.1:<port>` of the fixture server. */
  readonly origin: string
  /** Temporary git repository whose `origin` remote points at the fixture. */
  readonly repoPath: string
}

export type HostedReviewFixtureOptions = {
  /** Env applied on top of the neutralized gh environment; `null` unsets a key. */
  env?: (origin: string) => Readonly<Record<string, string | null>>
  remoteUrl: (origin: string) => string
  route: HostedReviewFixtureRoute
}

export function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

type FixtureResources = {
  server: Server
  directories: string[]
  restoreEnv: () => void
}

async function closeServer(server: Server): Promise<void> {
  // Why: fetch keep-alive sockets outlive the request and close() waits on them.
  // Drop them first so teardown cannot stall on an idle connection.
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

async function releaseFixture(resources: FixtureResources): Promise<void> {
  resources.restoreEnv()
  await closeServer(resources.server)
  await Promise.all(
    resources.directories.map((directory) => rm(directory, { recursive: true, force: true }))
  )
}

function applyFixtureEnv(overrides: Readonly<Record<string, string | null>>): () => void {
  const keys = [...NEUTRALIZED_GH_ENV_KEYS, ...Object.keys(overrides)]
  const previous = new Map<string, string | undefined>(keys.map((key) => [key, process.env[key]]))
  for (const key of NEUTRALIZED_GH_ENV_KEYS) {
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = value
    }
  }
}

/**
 * Install hosted-review integration fixtures for the surrounding suite.
 *
 * Teardown runs from `afterEach`, not from the test body: Vitest abandons a
 * timed-out test's promise, so a `finally` inside the case never runs and its
 * listening server keeps the pool worker alive for the rest of the run.
 */
export function useHostedReviewIntegrationFixtures(): {
  start: (options: HostedReviewFixtureOptions) => Promise<HostedReviewFixture>
} {
  const active: FixtureResources[] = []

  afterEach(async () => {
    const pending = active.splice(0, active.length)
    _resetGitHubHostAuthCache()
    _resetOriginGitHubApiRepositoryCache()
    await Promise.all(pending.map(releaseFixture))
  })

  const start = async (options: HostedReviewFixtureOptions): Promise<HostedReviewFixture> => {
    const seen: SeenRequest[] = []
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      seen.push({
        pathname: url.pathname,
        search: url.search,
        authorization: req.headers.authorization
      })
      if (options.route(url, res)) {
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'not found' }))
    })
    const directories: string[] = []
    const resources: FixtureResources = { server, directories, restoreEnv: () => {} }
    // Why: register before the first await so even a rejected start tears down.
    active.push(resources)

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP server address')
    }
    const origin = `http://127.0.0.1:${address.port}`

    const ghConfigDir = await mkdtemp(join(tmpdir(), 'orca-hosted-review-gh-config-'))
    directories.push(ghConfigDir)
    resources.restoreEnv = applyFixtureEnv({
      ORCA_GH_EXEC_TIMEOUT_MS: String(HOSTED_REVIEW_GH_PROBE_TIMEOUT_MS),
      GH_CONFIG_DIR: ghConfigDir,
      ...options.env?.(origin)
    })

    const repoPath = await mkdtemp(join(tmpdir(), 'orca-hosted-review-repo-'))
    directories.push(repoPath)
    await execFileAsync('git', ['init'], { cwd: repoPath })
    await execFileAsync('git', ['remote', 'add', 'origin', options.remoteUrl(origin)], {
      cwd: repoPath
    })

    return { seen, origin, repoPath }
  }

  return { start }
}
