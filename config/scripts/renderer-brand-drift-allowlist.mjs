import fs from 'node:fs'
import path from 'node:path'

import { measure, NEW_NAME, OLD_NAME, RENDERER_ROOT } from './renderer-translate-fallbacks.mjs'

/**
 * The known stale renderer fallbacks, one `file key` per line.
 *
 * Entries instead of whole-tree counts so a PR that adds a correct translate()
 * call never edits this file, and two PRs fixing different entries never touch
 * the same line (ORCA-1138). Both the vitest pin and the static-analysis ratchet
 * judge the tree through checkTree() below.
 */
export const ALLOWLIST_PATH = 'config/renderer-brand-drift-allowlist.txt'

export const entryOf = (call) => `${call.file} ${call.key}`

export function parseAllowlist(text) {
  const entries = new Set()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const parts = line.split(/\s+/)
    if (parts.length !== 2) {
      throw new Error(`Malformed ${ALLOWLIST_PATH} line: ${raw}`)
    }
    entries.add(parts.join(' '))
  }
  return entries
}

export function readAllowlist(root = process.cwd()) {
  return parseAllowlist(fs.readFileSync(path.join(root, ALLOWLIST_PATH), 'utf8'))
}

function violationOf(call, isRenameDrift) {
  const where = `${RENDERER_ROOT}/${call.file}`
  const problem = isRenameDrift
    ? `still says ${OLD_NAME} where the catalog says ${JSON.stringify(call.expected)} (${NEW_NAME})`
    : `differs from the catalog value ${JSON.stringify(call.expected)}`
  return {
    path: where,
    line: call.line,
    key: call.key,
    message: `${where}:${call.line} ${call.key}: fallback ${JSON.stringify(call.fallback)} ${problem}`
  }
}

/**
 * Every stale fallback the allowlist does not cover. Rename drift is never
 * covered: it reached 0 with ORCA-443 and there is nothing left to grandfather.
 * `unused` entries no longer match anything; they pass, so fixing one needs no
 * allowlist edit, and are safe to delete.
 */
export function checkTree(root = process.cwd(), allowlist = readAllowlist(root)) {
  const { calls, unresolved, stale, renameDrift } = measure(root)
  const renamed = new Set(renameDrift)
  const used = new Set()
  const violations = []
  for (const call of stale) {
    const entry = entryOf(call)
    if (!renamed.has(call) && allowlist.has(entry)) {
      used.add(entry)
      continue
    }
    violations.push(violationOf(call, renamed.has(call)))
  }
  const unused = [...allowlist].filter((entry) => !used.has(entry))
  return { calls, unresolved, violations, unused }
}
