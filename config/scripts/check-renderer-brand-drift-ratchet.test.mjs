import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  findIncreases,
  main,
  parseBaseline,
  readBaselineAt,
  resolveBaseRef
} from './check-renderer-brand-drift-ratchet.mjs'

const BASELINE_PATH = 'config/renderer-brand-drift-baseline.txt'

function baselineText({ rename, stale, resolved }) {
  return [
    '# comment line',
    '',
    `rename-drift ${rename}`,
    `stale-fallbacks ${stale}`,
    `resolved-calls ${resolved}`,
    ''
  ].join('\n')
}

const repos = []

/** A throwaway git repo whose base commit carries `base` on `main`. */
function repoWithBase(base) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-drift-ratchet-'))
  repos.push(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  fs.mkdirSync(path.join(root, 'config'), { recursive: true })
  fs.writeFileSync(path.join(root, BASELINE_PATH), baselineText(base))
  git('add', '-A')
  git('commit', '-m', 'baseline')
  return root
}

afterAll(() => {
  for (const root of repos) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('renderer brand drift baseline parsing', () => {
  it('reads the counters and ignores comments and blank lines', () => {
    expect(parseBaseline(baselineText({ rename: 529, stale: 591, resolved: 12474 }))).toEqual({
      'rename-drift': 529,
      'stale-fallbacks': 591,
      'resolved-calls': 12474
    })
  })

  it('rejects a line that is not a counter', () => {
    expect(() => parseBaseline('rename-drift lots')).toThrow(/Malformed/)
  })
})

describe('the ratchet only lets the counters fall', () => {
  // The case the equality pin cannot see: a commit that adds a drift site AND
  // raises the baseline to match it. Both sides agree with the tree, so only the
  // comparison against the base can reject it. If this passes, it is not a ratchet.
  it('rejects a raise that a matching tree would otherwise justify', () => {
    const base = { 'rename-drift': 529, 'stale-fallbacks': 591, 'resolved-calls': 12474 }
    const head = { 'rename-drift': 530, 'stale-fallbacks': 592, 'resolved-calls': 12475 }
    expect(findIncreases(base, head)).toEqual([
      { name: 'rename-drift', before: 529, after: 530 },
      { name: 'stale-fallbacks', before: 591, after: 592 }
    ])
  })

  it('accepts a slice that lowers them', () => {
    const base = { 'rename-drift': 529, 'stale-fallbacks': 591, 'resolved-calls': 12474 }
    const head = { 'rename-drift': 455, 'stale-fallbacks': 517, 'resolved-calls': 12474 }
    expect(findIncreases(base, head)).toEqual([])
  })

  it('accepts an unchanged baseline', () => {
    const counts = { 'rename-drift': 529, 'stale-fallbacks': 591, 'resolved-calls': 12474 }
    expect(findIncreases(counts, { ...counts })).toEqual([])
  })

  it('leaves resolved-calls ungated in both directions', () => {
    const base = { 'rename-drift': 529, 'stale-fallbacks': 591, 'resolved-calls': 12474 }
    expect(findIncreases(base, { ...base, 'resolved-calls': 12999 })).toEqual([])
    expect(findIncreases(base, { ...base, 'resolved-calls': 11000 })).toEqual([])
  })

  it('ignores a counter the base did not have yet', () => {
    const base = { 'rename-drift': 529 }
    expect(findIncreases(base, { 'rename-drift': 529, 'stale-fallbacks': 9999 })).toEqual([])
  })
})

describe('reading the baseline from the base ref', () => {
  it('returns the counters committed there', () => {
    const root = repoWithBase({ rename: 529, stale: 591, resolved: 12474 })
    expect(readBaselineAt('main', root)).toEqual({
      'rename-drift': 529,
      'stale-fallbacks': 591,
      'resolved-calls': 12474
    })
  })

  it('returns null when the base predates the baseline file', () => {
    const root = repoWithBase({ rename: 1, stale: 1, resolved: 1 })
    execFileSync('git', ['rm', '-q', BASELINE_PATH], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'drop baseline'], { cwd: root })
    execFileSync('git', ['tag', 'before-baseline'], { cwd: root })
    expect(readBaselineAt('before-baseline', root)).toBeNull()
  })
})

/** A throwaway repo with a baseline but no ref to compare it against. */
function repoWithoutBase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-drift-ratchet-nobase-'))
  repos.push(root)
  execFileSync('git', ['init', '-b', 'work'], { cwd: root, stdio: 'ignore' })
  fs.mkdirSync(path.join(root, 'config'), { recursive: true })
  // measure() walks src/renderer/src; empty keeps every counter at zero, so the
  // baseline matches the tree and main() reaches the base-ref branch under test.
  const locales = path.join(root, 'src', 'renderer', 'src', 'i18n', 'locales')
  fs.mkdirSync(locales, { recursive: true })
  fs.writeFileSync(path.join(locales, 'en.json'), '{}')
  fs.writeFileSync(
    path.join(root, BASELINE_PATH),
    baselineText({ rename: 0, stale: 0, resolved: 0 })
  )
  return root
}

describe('a run with no base ref', () => {
  it('fails closed on a pull request, where the base is always fetched', () => {
    expect(main(repoWithoutBase(), { CI: 'true', GITHUB_EVENT_NAME: 'pull_request' })).toBe(1)
  })

  it('skips on a release run, which checks out a bare SHA and has no base', () => {
    // Why not env.CI: that was the old condition and it blocked lab.61. A release
    // builds already-merged main, which the PR gate judged on the way in.
    expect(main(repoWithoutBase(), { CI: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' })).toBe(0)
  })
})

describe('choosing the ref to compare against', () => {
  it('prefers the PR base branch over main', () => {
    const root = repoWithBase({ rename: 1, stale: 1, resolved: 1 })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/release', head], { cwd: root })
    expect(resolveBaseRef(root, { GITHUB_BASE_REF: 'release' })).toBe('origin/release')
  })

  it('falls back to main when the PR base is not fetched', () => {
    const root = repoWithBase({ rename: 1, stale: 1, resolved: 1 })
    expect(resolveBaseRef(root, { GITHUB_BASE_REF: 'release' })).toBe('main')
  })

  it('returns null when nothing resolves', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-drift-ratchet-empty-'))
    repos.push(root)
    execFileSync('git', ['init', '-b', 'work'], { cwd: root, stdio: 'ignore' })
    expect(resolveBaseRef(root, {})).toBeNull()
  })
})
