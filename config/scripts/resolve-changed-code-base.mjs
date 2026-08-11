/**
 * Picks the ref that changed-line quality gates should measure a PR against.
 *
 * A normal PR gets the PR's own base: the lines it changed are the lines it
 * added to the fork. An upstream-sync PR is different — measuring it against
 * the fork's pre-sync tip counts every imported upstream line as "changed" and
 * bills the fork for upstream's existing debt. What a sync PR actually
 * contributes is its divergence from upstream, so it is measured against the
 * upstream tip it merged.
 *
 * The sync signal is structural, not a label or a title: a PR is a sync only if
 * it advances the fork's upstream frontier — that is, if it carries commits
 * from the upstream repository that the base branch does not have. Producing
 * that signal requires merging real commits from upstream, so a normal PR
 * cannot claim it, and merging a self-authored branch does not move the
 * frontier. Anything unresolvable (no upstream remote, shallow clone, an
 * unexpected shape) falls back to the PR base, which is the stricter measure.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const DEFAULT_UPSTREAM_REF = 'upstream/main'

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

function resolveCommit(revision, cwd) {
  if (!revision) {
    return null
  }
  return git(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], cwd)
}

function isAncestor(ancestor, descendant, cwd) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

export function resolveChangedCodeBase(
  prBase,
  upstreamRef = DEFAULT_UPSTREAM_REF,
  cwd = undefined
) {
  const upstreamTip = resolveCommit(upstreamRef, cwd)
  const prBaseCommit = resolveCommit(prBase, cwd)
  if (!upstreamTip || !prBaseCommit) {
    return prBase
  }
  // The upstream frontier on each side: the newest upstream commit each one has.
  const headFrontier = git(['merge-base', 'HEAD', upstreamTip], cwd)
  const baseFrontier = git(['merge-base', prBaseCommit, upstreamTip], cwd)
  if (!headFrontier || !baseFrontier || headFrontier === baseFrontier) {
    return prBase
  }
  // Why the ancestry check: only a frontier that strictly advances the base's
  // is a sync. A branch that is merely behind upstream must not widen its base.
  return isAncestor(baseFrontier, headFrontier, cwd) ? headFrontier : prBase
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const [prBase, upstreamRef] = process.argv.slice(2).filter((argument) => argument !== '--')
  if (!prBase) {
    console.error('usage: resolve-changed-code-base.mjs <pr-base-sha> [upstream-ref]')
    process.exit(2)
  }
  console.log(resolveChangedCodeBase(prBase, upstreamRef || DEFAULT_UPSTREAM_REF))
}
