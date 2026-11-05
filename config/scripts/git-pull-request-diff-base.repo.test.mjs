import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePullRequestDiffBase } from './git-pull-request-diff-base.mjs'

// Why a real repository: the first-parent rule lives in the git read, which the pure selector
// test never exercises.
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
  sha.staleBase = commit('stale event base')
  sha.prBase = commit('base the checkout was built from')
  run(['checkout', '-q', '-b', 'feature'])
  sha.head = commit('feature work')
  // What actions/checkout builds for a PR: first parent is the base branch.
  sha.prMerge = run([
    'commit-tree',
    `${sha.head}^{tree}`,
    '-p',
    sha.prBase,
    '-p',
    sha.head,
    '-m',
    'synthetic refs/pull/N/merge'
  ])
  run(['checkout', '-q', '--detach', sha.prMerge])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('pull request diff base resolution against a repository', () => {
  it('measures a pull request against the checkout first parent, not the requested base', () => {
    expect(resolvePullRequestDiffBase(repo, sha.staleBase, 'pull_request')).toBe(sha.prBase)
  })

  it('keeps the requested base outside a pull request event', () => {
    expect(resolvePullRequestDiffBase(repo, sha.staleBase, 'push')).toBe(sha.staleBase)
  })
})
