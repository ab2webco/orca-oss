import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePullRequestDiffBase } from './git-pull-request-diff-base.mjs'

/**
 * Why a real repository and not the pure selector: the two guarantees that
 * matter live in `resolvePullRequestDiffBase`, which reads git — that the sync
 * base is derived from the checkout's first parent rather than the caller's
 * argument, and that sync widening stays opt-in. Both survive a passing suite
 * that only covers `selectPullRequestDiffBase`.
 *
 * The fixture makes `requestedBase` and `headParents[0]` resolve to *different*
 * sync bases on purpose. That divergence is the only condition under which the
 * first guarantee is observable, and it is exactly the condition the override
 * exists for.
 */
let repo = ''
const sha = {}

function run(args, cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commit(message) {
  const file = `${message.replace(/\W+/g, '-')}.txt`
  writeFileSync(path.join(repo, file), `${message}\n`)
  run(['add', file])
  run(['commit', '-m', message])
  return run(['rev-parse', 'HEAD'])
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'orca-pr-diff-base-'))
  run(['init', '--initial-branch=main'], repo)
  run(['config', 'user.email', 'e2e@orca.test'])
  run(['config', 'user.name', 'e2e'])
  sha.root = commit('shared root')

  run(['checkout', '-q', '-b', 'upstream-line'])
  sha.upstreamOld = commit('upstream old')
  sha.upstreamTip = commit('upstream tip')
  // resolveChangedCodeBase resolves `upstream/main`, so the fixture must own that ref.
  run(['update-ref', 'refs/remotes/upstream/main', sha.upstreamTip])

  // The PR base carries upstream only up to upstreamOld.
  run(['checkout', '-q', '-b', 'fork-main', sha.root])
  commit('fork work')
  run(['merge', '--no-edit', '--no-ff', sha.upstreamOld])
  sha.prBase = run(['rev-parse', 'HEAD'])

  // The sync head advances the frontier to upstreamTip.
  run(['checkout', '-q', '-b', 'sync', sha.prBase])
  run(['merge', '--no-edit', '--no-ff', sha.upstreamTip])
  sha.syncHead = run(['rev-parse', 'HEAD'])

  // A caller-supplied base that ALREADY contains upstreamTip, so its own sync
  // base is itself — never upstreamTip. Deriving from it instead of from the
  // first parent therefore produces a visibly different answer.
  run(['checkout', '-q', '-b', 'already-current', sha.upstreamTip])
  sha.aheadOfUpstream = commit('base already at upstream tip')

  // What actions/checkout builds for a PR: first parent is the base branch.
  sha.prMerge = run([
    'commit-tree',
    `${sha.syncHead}^{tree}`,
    '-p',
    sha.prBase,
    '-p',
    sha.syncHead,
    '-m',
    'synthetic refs/pull/N/merge'
  ])
  run(['checkout', '-q', '--detach', sha.prMerge])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('pull request diff base resolution against a repository', () => {
  it('derives the sync base from the checkout first parent, not the requested base', () => {
    // The requested base's own sync base is itself; the first parent's is the
    // upstream tip. Getting `aheadOfUpstream` back would mean the caller's
    // argument decided the measuring point — the thing the override forbids.
    expect(
      resolvePullRequestDiffBase(repo, sha.aheadOfUpstream, 'pull_request', { syncAware: true })
    ).toBe(sha.upstreamTip)
  })

  it('keeps sync widening opt-in, so a gate that has not opted in still gets the PR base', () => {
    // check:code-quality:changed calls without options and must stay on the PR
    // base: ORCA-205 measured 3 real findings that the wider base hides.
    expect(resolvePullRequestDiffBase(repo, sha.aheadOfUpstream, 'pull_request')).toBe(sha.prBase)
    expect(
      resolvePullRequestDiffBase(repo, sha.aheadOfUpstream, 'pull_request', { syncAware: false })
    ).toBe(sha.prBase)
  })

  it('leaves a non-sync pull request on its own base even with widening enabled', () => {
    run(['checkout', '-q', '-b', 'normal-pr', sha.prBase])
    const normalHead = commit('ordinary fork work')
    const normalMerge = run([
      'commit-tree',
      `${normalHead}^{tree}`,
      '-p',
      sha.prBase,
      '-p',
      normalHead,
      '-m',
      'synthetic normal pull request'
    ])
    run(['checkout', '-q', '--detach', normalMerge])
    try {
      expect(
        resolvePullRequestDiffBase(repo, sha.aheadOfUpstream, 'pull_request', { syncAware: true })
      ).toBe(sha.prBase)
    } finally {
      run(['checkout', '-q', '--detach', sha.prMerge])
    }
  })

  // Why read the source: the default keeps the code-quality gate on the PR base,
  // but nothing stops a future edit from opting that one call site in. ORCA-205
  // measured 3 real findings the wider base hides, and hiding them again would
  // be silent. This fails loudly when that gate opts in, which is when ORCA-205
  // should be updating this test on purpose.
  it('does not let the changed-code-quality gate opt into sync widening', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'check-changed-code-quality.mjs'),
      'utf8'
    )
    expect(source).toContain('resolvePullRequestDiffBase')
    expect(source).not.toContain('syncAware')
  })

  it('keeps the requested base outside a pull request event', () => {
    expect(resolvePullRequestDiffBase(repo, sha.aheadOfUpstream, 'push', { syncAware: true })).toBe(
      sha.aheadOfUpstream
    )
  })
})
