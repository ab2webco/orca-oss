import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveChangedCodeBase } from './resolve-changed-code-base.mjs'

// Why a real repository: every branch of the resolver is a git question
// (merge-base, ancestry, a missing remote), and a stub would only re-assert the
// shape this file exists to check.
let repo = ''
let originalCwd = ''
const sha = {}

function run(args, cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// Why one file per commit: the lineages get merged, and a shared file would
// make this fixture fail on a text conflict instead of on the resolver.
function commit(message) {
  const file = `${message.replace(/\W+/g, '-')}.txt`
  writeFileSync(path.join(repo, file), `${message}\n`)
  run(['add', file])
  run(['commit', '-m', message])
  return run(['rev-parse', 'HEAD'])
}

beforeAll(() => {
  originalCwd = process.cwd()
  repo = mkdtempSync(path.join(tmpdir(), 'orca-changed-code-base-'))
  run(['init', '--initial-branch=main'], repo)
  run(['config', 'user.email', 'e2e@orca.test'])
  run(['config', 'user.name', 'e2e'])
  sha.shared = commit('shared root')

  // An "upstream" line the fork does not author, plus a fork line off the same root.
  run(['checkout', '-b', 'upstream-main'])
  sha.upstreamOld = commit('upstream old')
  sha.upstreamTip = commit('upstream tip')

  run(['checkout', '-b', 'fork-main', sha.shared])
  sha.forkOnly = commit('fork only')

  // The fork's base already carries upstream up to upstreamOld.
  run(['merge', '--no-edit', '--no-ff', sha.upstreamOld])
  sha.prBase = run(['rev-parse', 'HEAD'])

  // A sync branch advances the frontier from upstreamOld to upstreamTip.
  run(['checkout', '-b', 'sync', sha.prBase])
  run(['merge', '--no-edit', '--no-ff', sha.upstreamTip])
  sha.syncTip = run(['rev-parse', 'HEAD'])

  // A normal branch adds fork work without touching the frontier.
  run(['checkout', '-b', 'normal', sha.prBase])
  sha.normalTip = commit('normal work')

  process.chdir(repo)
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(repo, { recursive: true, force: true })
})

describe('changed-code base resolution', () => {
  it('widens a sync to the upstream tip it merged', () => {
    run(['checkout', '--detach', sha.syncTip])
    expect(resolveChangedCodeBase(sha.prBase, 'upstream-main')).toBe(sha.upstreamTip)
  })

  it('keeps the PR base for a branch that adds no upstream commits', () => {
    run(['checkout', '--detach', sha.normalTip])
    expect(resolveChangedCodeBase(sha.prBase, 'upstream-main')).toBe(sha.prBase)
  })

  it('keeps the PR base for a branch merely behind upstream', () => {
    // The frontier differs, but the base's is ahead — not a sync, and widening
    // here would let a stale branch measure itself against less than its base.
    run(['checkout', '--detach', sha.forkOnly])
    expect(resolveChangedCodeBase(sha.prBase, 'upstream-main')).toBe(sha.prBase)
  })

  it('falls back to the PR base when the upstream ref is unresolvable', () => {
    run(['checkout', '--detach', sha.syncTip])
    expect(resolveChangedCodeBase(sha.prBase, 'no-such-remote/main')).toBe(sha.prBase)
  })
})
