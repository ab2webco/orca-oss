import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const CACHE_ROOT = join(REPO_ROOT, 'tests', 'e2e', '.cross-version-checkouts')

// Bump when extraction or the alias rewrite changes so cached trees are rebuilt.
const CHECKOUT_FORMAT = 1

// Why: the wire endpoints only need the runtime RPC host, the renderer client, and
// the shared codec. Skipping cli/relay keeps a cold CI extraction a few seconds.
const ARCHIVE_PATHS = ['src/main', 'src/shared', 'src/preload', 'src/renderer', 'src/types']

const BASELINE_REF_ENV = 'ORCA_CROSS_VERSION_BASELINE_REF'
const DESKTOP_RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

export type ReleaseCheckout = {
  /** The ref as requested, e.g. `v1.4.169`. */
  ref: string
  /** Resolved commit the tree was extracted from. */
  commit: string
  /** Directory name under the cache root; also the dynamic-import path segment. */
  label: string
  /** Absolute path to the extracted checkout root (contains `src/`). */
  root: string
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function compareReleaseTags(a: string, b: string): number {
  const left = DESKTOP_RELEASE_TAG.exec(a)
  const right = DESKTOP_RELEASE_TAG.exec(b)
  if (!left || !right) {
    return 0
  }
  for (let index = 1; index <= 3; index++) {
    const diff = Number(left[index]) - Number(right[index])
    if (diff !== 0) {
      return diff
    }
  }
  return comparePrereleases(left[4], right[4])
}

// Semver ordering: a release outranks any prerelease of the same version, and between two
// prereleases a numeric identifier compares as a number so `lab.9` sorts below `lab.82`.
function comparePrereleases(a: string | undefined, b: string | undefined): number {
  if (a === b) {
    return 0
  }
  if (a === undefined) {
    return 1
  }
  if (b === undefined) {
    return -1
  }
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const one = left[index]
    const other = right[index]
    if (one === undefined) {
      return -1
    }
    if (other === undefined) {
      return 1
    }
    if (one === other) {
      continue
    }
    const numeric = /^\d+$/.test(one) && /^\d+$/.test(other)
    return numeric ? Number(one) - Number(other) : one.localeCompare(other)
  }
  return 0
}

/**
 * The version point the harness pairs current code against. An explicit
 * {@link BASELINE_REF_ENV} wins; otherwise the newest release this history descends from.
 *
 * Throws rather than skipping: a cross-version lane that quietly runs nothing is
 * the exact failure this harness exists to prevent.
 */
export function resolveBaselineReleaseRef(): string {
  const override = process.env[BASELINE_REF_ENV]?.trim()
  if (override) {
    return override
  }
  let tags: string[]
  let reachable: Set<string>
  try {
    tags = git(['tag', '--list', 'v[0-9]*']).split('\n').filter(Boolean)
    reachable = new Set(
      git(['tag', '--list', 'v[0-9]*', '--merged', 'HEAD']).split('\n').filter(Boolean)
    )
  } catch (error) {
    throw new Error(
      `Cross-version harness could not list git tags in ${REPO_ROOT}: ${String(error)}. ` +
        `Run it inside a git checkout, or pin a ref with ${BASELINE_REF_ENV}.`
    )
  }
  const latest = selectBaselineReleaseTag(tags, (tag) => reachable.has(tag))
  if (!latest) {
    throw new Error(
      `Cross-version harness found no vX.Y.Z release tag reachable from HEAD (saw ${tags.length} tag(s) total, ` +
        `${reachable.size} of them reachable). A shallow CI clone has no tags: use \`actions/checkout\` with ` +
        `\`fetch-depth: 0\`, or pin a ref with ${BASELINE_REF_ENV}.`
    )
  }
  return latest
}

/**
 * The newest release-shaped tag the given history actually descends from.
 *
 * Why reachability and not just the newest tag: a development clone carries the `upstream`
 * remote's tags too, so "newest in the clone" can name a release this repo never merged. Pairing
 * current code against a build that never shipped together with it proves nothing — and it hangs
 * the journey instead of failing it, because the two sides disagree about the protocol outright.
 *
 * Why prereleases count: a repo whose every cut is `vX.Y.Z-lab.N` has no other baseline, and a
 * lane with no baseline is the one failure mode this harness must never have.
 */
export function selectBaselineReleaseTag(
  tags: readonly string[],
  isReachable: (tag: string) => boolean
): string | null {
  return (
    tags
      .filter((tag) => DESKTOP_RELEASE_TAG.test(tag) && isReachable(tag))
      .sort(compareReleaseTags)
      .at(-1) ?? null
  )
}

function resolveCommit(ref: string): string {
  try {
    return git(['rev-parse', `${ref}^{commit}`])
  } catch (error) {
    throw new Error(
      `Cross-version harness could not resolve ref "${ref}" to a commit: ${String(error)}. ` +
        'The ref must exist locally; a shallow CI clone needs `fetch-depth: 0`.'
    )
  }
}

function isRewritableSource(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.tsx')
}

function isTestSource(name: string): boolean {
  return /\.(test|bench|spec)\.(ts|tsx)$/.test(name)
}

const ALIAS_SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])@(renderer)?\/([^'"]+)\2/g

/**
 * The extracted tree is imported directly, so `@/…` must resolve inside that tree.
 * Vite's alias is global and points at the working tree, which would silently run
 * current renderer code inside the "old" client. Rewrite to relative paths instead.
 */
function rewriteRendererAliases(file: string, rendererRoot: string): boolean {
  const source = readFileSync(file, 'utf8')
  if (!source.includes("'@/") && !source.includes('"@/') && !source.includes('@renderer/')) {
    return false
  }
  const rewritten = source.replace(
    ALIAS_SPECIFIER,
    (_match, keyword: string, quote: string, _renderer: string | undefined, target: string) => {
      const absolute = join(rendererRoot, target)
      let relativePath = relative(dirname(file), absolute).split('\\').join('/')
      if (!relativePath.startsWith('.')) {
        relativePath = `./${relativePath}`
      }
      return `${keyword}${quote}${relativePath}${quote}`
    }
  )
  if (rewritten === source) {
    return false
  }
  writeFileSync(file, rewritten)
  return true
}

function prepareExtractedTree(root: string): { rewritten: number; pruned: number } {
  const rendererRoot = join(root, 'src', 'renderer', 'src')
  let rewritten = 0
  let pruned = 0
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      // Why: the old tree is imported, never collected. Dropping its tests keeps the
      // cache small and keeps stale specs out of every repo-wide tool's file walk.
      if (isTestSource(entry.name)) {
        rmSync(full)
        pruned++
        continue
      }
      if (isRewritableSource(entry.name) && rewriteRendererAliases(full, rendererRoot)) {
        rewritten++
      }
    }
  }
  walk(join(root, 'src'))
  return { rewritten, pruned }
}

type CheckoutStamp = { commit: string; format: number }

function readStamp(root: string): CheckoutStamp | null {
  try {
    return JSON.parse(readFileSync(join(root, 'checkout-stamp.json'), 'utf8')) as CheckoutStamp
  } catch {
    return null
  }
}

/**
 * Extract `src/` at `ref` into a cached, gitignored checkout the test can import.
 * Cached by resolved commit, so a moved tag or a bumped rewrite format re-extracts.
 */
export function materializeReleaseCheckout(ref: string): ReleaseCheckout {
  const commit = resolveCommit(ref)
  const label = ref.replace(/[^A-Za-z0-9._-]/g, '_')
  const root = join(CACHE_ROOT, label)
  const stamp = readStamp(root)
  if (stamp?.commit === commit && stamp.format === CHECKOUT_FORMAT) {
    return { ref, commit, label, root }
  }

  mkdirSync(CACHE_ROOT, { recursive: true })
  const staging = join(CACHE_ROOT, `.staging-${label}-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    // `git archive | tar -x` keeps the extraction independent of the working tree,
    // so an injected violation in the working tree cannot leak into the old side.
    execFileSync(
      'sh',
      ['-c', `git archive ${commit} ${ARCHIVE_PATHS.join(' ')} | tar -x -C "${staging}"`],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    prepareExtractedTree(staging)
    writeFileSync(
      join(staging, 'checkout-stamp.json'),
      `${JSON.stringify({ commit, format: CHECKOUT_FORMAT } satisfies CheckoutStamp, null, 2)}\n`
    )
    rmSync(root, { recursive: true, force: true })
    renameSync(staging, root)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (readStamp(root)?.commit === commit) {
      return { ref, commit, label, root }
    }
    throw new Error(`Cross-version harness failed to extract ${ref} (${commit}): ${String(error)}`)
  }

  if (!existsSync(join(root, 'src', 'shared', 'terminal-stream-protocol.ts'))) {
    throw new Error(
      `Cross-version checkout for ${ref} is missing the terminal stream protocol; ` +
        'the wire surface moved and the harness needs updating.'
    )
  }
  return { ref, commit, label, root }
}
