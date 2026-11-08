import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
  ALLOWLIST_PATH,
  checkTree,
  parseAllowlist,
  readAllowlist
} from './renderer-brand-drift-allowlist.mjs'

// Ratchet gate for the renderer brand drift allowlist.
//
// checkTree() judges TODAY's tree, as the vitest pin does. What it cannot see is
// a commit that adds a stale fallback and lists it in the same breath. This gate
// closes that by reading the allowlist from the PR base: entries may only go.

function git(args, cwd) {
  try {
    // stderr ignored: a missing path at the base ref is an expected answer here.
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** The ref whose allowlist this branch may not extend. */
export function resolveBaseRef(cwd = process.cwd(), env = process.env) {
  const candidates = [
    env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : null,
    'origin/main',
    'main'
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], cwd)) {
      return candidate
    }
  }
  return null
}

/** The allowlist as committed at `ref`, or null when the file is not there yet. */
export function readAllowlistAt(ref, cwd = process.cwd()) {
  const text = git(['show', `${ref}:${ALLOWLIST_PATH}`], cwd)
  return text === null ? null : parseAllowlist(text)
}

const FIX_HINT = [
  '',
  '  A renderer translate() fallback must match the catalog value its key',
  '  resolves to — the catalog is what actually renders. Copy the catalog',
  '  value verbatim into the fallback; never hand-apply the rename, or you',
  '  will rename a branch name, a path, or a sub-brand the catalog keeps.',
  ''
]

export function main(root = process.cwd(), env = process.env) {
  const allowlist = readAllowlist(root)
  const { violations, unused } = checkTree(root, allowlist)
  if (violations.length > 0) {
    for (const { path, line, message } of violations) {
      console.error(`::error file=${path},line=${line}::${message}`)
    }
    console.error(
      [
        '',
        `  ❌  ${violations.length} renderer fallback(s) drifted from the catalog.`,
        ...FIX_HINT
      ].join('\n')
    )
    return 1
  }

  const baseRef = resolveBaseRef(root, env)
  if (!baseRef) {
    // Why the event and not env.CI: only a PR run is guaranteed a base. The
    // release job checks out a bare SHA with no origin/main, and failing closed
    // there blocked lab.61 on a comparison that run has nothing to make -- it
    // builds already-merged main, which the PR gate judged on the way in.
    const message = `no base ref to compare ${ALLOWLIST_PATH} against (tried origin/<base>, origin/main, main)`
    const expectsBase =
      env.GITHUB_EVENT_NAME === 'pull_request' || env.GITHUB_EVENT_NAME === 'pull_request_target'
    if (expectsBase) {
      console.error(`::error::${message}`)
      return 1
    }
    console.warn(`renderer brand drift ratchet: skipped — ${message}`)
    return 0
  }

  const baseEntries = readAllowlistAt(baseRef, root)
  if (baseEntries === null) {
    console.log(
      `renderer brand drift ratchet OK — ${ALLOWLIST_PATH} is new at ${baseRef}, nothing to ratchet against.`
    )
    return 0
  }

  const added = [...allowlist].filter((entry) => !baseEntries.has(entry))
  if (added.length > 0) {
    for (const entry of added) {
      console.error(
        `::error file=${ALLOWLIST_PATH}::${entry} is not listed at ${baseRef}; this list only shrinks`
      )
    }
    console.error(
      ['', '  ✅  Fix the new fallback(s). Listing them is not an option.', ...FIX_HINT].join('\n')
    )
    return 1
  }

  for (const entry of unused) {
    console.log(`renderer brand drift: "${entry}" is fixed; delete it from ${ALLOWLIST_PATH}.`)
  }
  console.log(
    `renderer brand drift ratchet OK — ${allowlist.size} known stale fallback(s) (base ${baseRef}: ${baseEntries.size}).`
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
