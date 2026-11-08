import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { main, readAllowlistAt, resolveBaseRef } from './check-renderer-brand-drift-ratchet.mjs'
import {
  BASE_ALLOWLIST,
  commitAll,
  fixtureRepo,
  gitIn,
  removeFixtureRepos,
  writeAllowlist,
  writeRenderer
} from './renderer-brand-drift-fixture.mjs'

afterAll(removeFixtureRepos)
afterEach(() => vi.restoreAllMocks())

/** Runs the gate against `main` as the PR base and returns its exit code and stderr. */
function runGate(root, env = {}) {
  const errors = []
  vi.spyOn(console, 'error').mockImplementation((line) => errors.push(line))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return { code: main(root, env), stderr: errors.join('\n') }
}

describe('the gate on a PR that adds renderer copy', () => {
  it('passes a new, correctly branded call with no allowlist edit', () => {
    const root = fixtureRepo()
    writeRenderer(root, { 'components/Added.tsx': "translate('greet', 'Hello')\n" })
    commitAll(root, 'add a call')
    expect(runGate(root)).toEqual({ code: 0, stderr: '' })
  })

  it('fails a new stale fallback with an annotation on its file and line', () => {
    const root = fixtureRepo()
    writeRenderer(root, { 'components/Added.tsx': "\n\ntranslate('second', 'Wrong second')\n" })
    commitAll(root, 'add a stale call')
    const { code, stderr } = runGate(root)
    expect(code).toBe(1)
    expect(stderr).toContain('::error file=src/renderer/src/components/Added.tsx,line=3::')
  })
})

describe('the allowlist only shrinks against the base', () => {
  it('rejects an entry the base did not list, even when the tree needs it', () => {
    const root = fixtureRepo()
    writeRenderer(root, { 'components/Added.tsx': "translate('second', 'Wrong second')\n" })
    writeAllowlist(root, `${BASE_ALLOWLIST}components/Added.tsx second\n`)
    commitAll(root, 'grandfather a new stale call')
    const { code, stderr } = runGate(root)
    expect(code).toBe(1)
    expect(stderr).toContain('components/Added.tsx second')
  })

  it('accepts dropping an entry once its fallback is fixed', () => {
    const root = fixtureRepo()
    writeRenderer(root, { 'components/First.tsx': "translate('first', 'First copy')\n" })
    writeAllowlist(root, 'components/Second.tsx second\n')
    commitAll(root, 'fix first')
    expect(runGate(root).code).toBe(0)
  })

  it('has nothing to ratchet against when the base predates the allowlist', () => {
    const root = fixtureRepo({ allowlist: null })
    writeAllowlist(root, BASE_ALLOWLIST)
    commitAll(root, 'add allowlist')
    expect(readAllowlistAt('main', root)).toBeNull()
    expect(runGate(root).code).toBe(0)
  })

  it('reads the entries committed at the base', () => {
    expect([...readAllowlistAt('main', fixtureRepo())]).toEqual([
      'components/First.tsx first',
      'components/Second.tsx second'
    ])
  })
})

/** A repo with an allowlist but no ref to compare it against. */
function repoWithoutBase() {
  const root = fixtureRepo()
  gitIn(root)('branch', '-qD', 'main')
  return root
}

describe('a run with no base ref', () => {
  it('fails closed on a pull request, where the base is always fetched', () => {
    expect(runGate(repoWithoutBase(), { CI: 'true', GITHUB_EVENT_NAME: 'pull_request' }).code).toBe(
      1
    )
  })

  it('skips on a release run, which checks out a bare SHA and has no base', () => {
    // Why not env.CI: that was the old condition and it blocked lab.61. A release
    // builds already-merged main, which the PR gate judged on the way in.
    expect(
      runGate(repoWithoutBase(), { CI: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' }).code
    ).toBe(0)
  })
})

describe('choosing the ref to compare against', () => {
  it('prefers the PR base branch over main', () => {
    const root = fixtureRepo()
    const head = gitIn(root)('rev-parse', 'HEAD').trim()
    gitIn(root)('update-ref', 'refs/remotes/origin/release', head)
    expect(resolveBaseRef(root, { GITHUB_BASE_REF: 'release' })).toBe('origin/release')
  })

  it('falls back to main when the PR base is not fetched', () => {
    expect(resolveBaseRef(fixtureRepo(), { GITHUB_BASE_REF: 'release' })).toBe('main')
  })

  it('returns null when nothing resolves', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-drift-ratchet-empty-'))
    execFileSync('git', ['init', '-b', 'work'], { cwd: root, stdio: 'ignore' })
    expect(resolveBaseRef(root, {})).toBeNull()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
