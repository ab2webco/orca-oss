import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { measure } from './renderer-translate-fallbacks.mjs'

// Ratchet gate for the renderer brand-name fallback baseline.
//
// The vitest guard next to this file pins the baseline against TODAY's tree, so
// a lone edit of the number goes red. What that pin cannot see is a change that
// adds drift and raises the number in the same commit — both sides move and the
// equality still holds. This gate closes that by reading the baseline from the
// PR base: the counters below may only fall.

const BASELINE_PATH = 'config/renderer-brand-drift-baseline.txt'
// resolved-calls is deliberately absent: see the baseline header.
const ONE_WAY_DOWN = ['rename-drift', 'stale-fallbacks']

export function parseBaseline(text) {
  const counts = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const [name, value] = line.split(/\s+/)
    const parsed = Number.parseInt(value, 10)
    if (!name || !Number.isInteger(parsed)) {
      throw new Error(`Malformed ${BASELINE_PATH} line: ${raw}`)
    }
    counts[name] = parsed
  }
  return counts
}

/** Counters that moved in the forbidden direction, base -> head. */
export function findIncreases(baseCounts, headCounts, names = ONE_WAY_DOWN) {
  const increases = []
  for (const name of names) {
    const before = baseCounts[name]
    const after = headCounts[name]
    if (!Number.isInteger(before) || !Number.isInteger(after)) {
      continue
    }
    if (after > before) {
      increases.push({ name, before, after })
    }
  }
  return increases
}

function git(args, cwd) {
  try {
    // stderr ignored: a missing path at the base ref is an expected answer here.
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** The ref whose baseline this branch may not exceed. */
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

/** The baseline as committed at `ref`, or null when the file is not there yet. */
export function readBaselineAt(ref, cwd = process.cwd()) {
  const text = git(['show', `${ref}:${BASELINE_PATH}`], cwd)
  return text === null ? null : parseBaseline(text)
}

export function main(root = process.cwd(), env = process.env) {
  const headCounts = parseBaseline(fs.readFileSync(path.join(root, BASELINE_PATH), 'utf8'))
  const measured = measure(root).counts

  const drifted = Object.keys(headCounts).filter((name) => headCounts[name] !== measured[name])
  if (drifted.length > 0) {
    for (const name of drifted) {
      console.error(
        `::error::${BASELINE_PATH} says ${name} ${headCounts[name]}, the tree measures ${measured[name]}`
      )
    }
    console.error('')
    console.error('  The baseline must match the tree before the ratchet can judge it.')
    console.error('  Run: pnpm vitest run --config config/vitest.config.ts \\')
    console.error('         config/scripts/renderer-brand-name-fallback.test.mjs')
    return 1
  }

  const baseRef = resolveBaseRef(root, env)
  if (!baseRef) {
    // Failing closed here would block anyone whose clone has no main to compare
    // against; in CI the base is always fetched, so there it is a real error.
    const message = `no base ref to compare ${BASELINE_PATH} against (tried origin/<base>, origin/main, main)`
    if (env.CI) {
      console.error(`::error::${message}`)
      return 1
    }
    console.warn(`renderer brand drift ratchet: skipped — ${message}`)
    return 0
  }

  const baseCounts = readBaselineAt(baseRef, root)
  if (baseCounts === null) {
    console.log(
      `renderer brand drift ratchet OK — ${BASELINE_PATH} is new at ${baseRef}, nothing to ratchet against.`
    )
    return 0
  }

  const increases = findIncreases(baseCounts, headCounts)
  if (increases.length > 0) {
    for (const { name, before, after } of increases) {
      console.error(
        `::error::${name} rose from ${before} to ${after}; this baseline only goes down`
      )
    }
    console.error('')
    console.error('╭──────────────────────────────────────────────────────────────────────────╮')
    console.error('│  ❌  renderer brand drift ratchet failed — the baseline went UP.          │')
    console.error('╰──────────────────────────────────────────────────────────────────────────╯')
    console.error('')
    console.error(`  Compared against ${baseRef}:`)
    console.error('')
    for (const { name, before, after } of increases) {
      console.error(`    • ${name}: ${before} → ${after}  (+${after - before})`)
    }
    console.error('')
    console.error('  A renderer translate() fallback must match the catalog value its key')
    console.error('  resolves to — the catalog is what actually renders. Copy the catalog')
    console.error('  value verbatim into the fallback; never hand-apply the rename, or you')
    console.error('  will rename a branch name, a path, or a sub-brand the catalog keeps.')
    console.error('')
    console.error('  ✅  Fix the new fallback(s). Raising the number is not an option.')
    console.error('')
    return 1
  }

  console.log(
    `renderer brand drift ratchet OK — rename-drift ${headCounts['rename-drift']}, ` +
      `stale-fallbacks ${headCounts['stale-fallbacks']} (base ${baseRef}: ` +
      `${baseCounts['rename-drift']}/${baseCounts['stale-fallbacks']}).`
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
