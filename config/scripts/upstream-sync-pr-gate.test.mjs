import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  decideSyncPr,
  renderSyncPrBody,
  SYNC_PR_ACTION,
  SYNC_PR_REASON
} from './upstream-sync-pr-gate.mjs'

const BASE = { base: 'main', syncBranch: 'upstream-sync/main' }

// The measured state of the branch this fork actually had pushed.
const MIRROR = { ...BASE, behind: 699, dropped: 676, conflicts: true }
const CLEAN = { ...BASE, behind: 12, dropped: 0, conflicts: false }

describe('the upstream sync PR gate', () => {
  it('refuses a PR from a branch that mirrors upstream', () => {
    const decision = decideSyncPr(MIRROR)
    expect(decision.action).toBe(SYNC_PR_ACTION.WITHDRAW)
    expect(decision.reason).toBe(SYNC_PR_REASON.DROPS_FORK_COMMITS)
    expect(decision.mergeable).toBe(false)
    expect(decision.dropped).toBe(676)
  })

  it('opens a PR when the branch keeps every base commit', () => {
    const decision = decideSyncPr(CLEAN)
    expect(decision.action).toBe(SYNC_PR_ACTION.OPEN)
    expect(decision.reason).toBe(SYNC_PR_REASON.CONTAINS_BASE)
    expect(decision.mergeable).toBe(true)
  })

  // The conflict flag says which route produced the branch, not whether merging
  // it deletes the fork. Deciding on the flag would misjudge both of these.
  it('refuses a branch that drops commits even when the merge reported clean', () => {
    expect(decideSyncPr({ ...MIRROR, conflicts: false }).action).toBe(SYNC_PR_ACTION.WITHDRAW)
  })

  it('allows a conflicted branch that still fast-forwards the base', () => {
    expect(decideSyncPr({ ...CLEAN, conflicts: true }).action).toBe(SYNC_PR_ACTION.OPEN)
  })

  it.each(['', ' ', 'unknown', '-1', '1.5', null, undefined])(
    'fails closed when the dropped count reads %o',
    (dropped) => {
      const decision = decideSyncPr({ ...MIRROR, dropped })
      expect(decision.action).toBe(SYNC_PR_ACTION.WITHDRAW)
      expect(decision.reason).toBe(SYNC_PR_REASON.UNMEASURED)
      expect(decision.dropped).toBeNull()
    }
  )

  it('reads the counts git prints, which are strings', () => {
    expect(decideSyncPr({ ...MIRROR, dropped: '676', behind: '699' }).dropped).toBe(676)
    expect(decideSyncPr({ ...CLEAN, dropped: '0' }).action).toBe(SYNC_PR_ACTION.OPEN)
  })
})

describe('the body the gate hands to gh', () => {
  it('names the count and forbids the merge when the branch is a mirror', () => {
    const decision = decideSyncPr(MIRROR)
    const body = renderSyncPrBody(decision, MIRROR)
    expect(body).toContain('Do not merge')
    expect(body).toContain('**676 commit(s)**')
    expect(body).not.toContain('Use a **merge commit**')
  })

  it('keeps the merge instruction only when the PR is proposable', () => {
    const body = renderSyncPrBody(decideSyncPr(CLEAN), CLEAN)
    expect(body).toContain('Use a **merge commit**')
    expect(body).not.toContain('Do not merge')
  })

  it('says the check could not run rather than implying the branch is fine', () => {
    const context = { ...MIRROR, dropped: '' }
    const body = renderSyncPrBody(decideSyncPr(context), context)
    expect(body).toContain('Do not merge')
    expect(body).toContain('could not run')
  })

  it('carries the retained-workflow diffstat when there is one, and omits it otherwise', () => {
    const discard = ' .github/workflows/pr.yml | 8 ++--'
    const withDiscard = renderSyncPrBody(decideSyncPr(CLEAN), {
      ...CLEAN,
      workflowCommits: 3,
      workflowDiscard: discard
    })
    expect(withDiscard).toContain('3 upstream commit(s) touched')
    expect(withDiscard).toContain(discard)
    expect(renderSyncPrBody(decideSyncPr(CLEAN), { ...CLEAN, workflowDiscard: '\n' })).not.toContain(
      '<details>'
    )
  })
})

describe('the gate CLI', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-pr-gate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(args) {
    const output = join(dir, 'output.txt')
    const body = join(dir, 'body.md')
    let status = 0
    try {
      execFileSync(
        process.execPath,
        [
          'config/scripts/decide-upstream-sync-pr.mjs',
          '--base',
          'main',
          '--sync-branch',
          'upstream-sync/main',
          '--body-file',
          body,
          '--output',
          output,
          ...args
        ],
        { encoding: 'utf8', stdio: 'pipe' }
      )
    } catch (error) {
      status = error.status
    }
    writeFileSync(output, readFileSync(output, 'utf8'), 'utf8')
    return {
      status,
      outputs: Object.fromEntries(
        readFileSync(output, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
      ),
      body: readFileSync(body, 'utf8')
    }
  }

  it('publishes a withdraw verdict for the mirror branch and succeeds', () => {
    const result = run(['--behind', '699', '--dropped', '676', '--conflicts', 'true'])
    expect(result.status).toBe(0)
    expect(result.outputs.action).toBe('withdraw')
    expect(result.outputs.mergeable).toBe('false')
    expect(result.outputs.dropped).toBe('676')
    expect(result.body).toContain('Do not merge')
  })

  it('publishes an open verdict and the title gh will use', () => {
    const result = run(['--behind', '12', '--dropped', '0', '--conflicts', 'false'])
    expect(result.status).toBe(0)
    expect(result.outputs.action).toBe('open')
    expect(result.outputs.title).toBe('chore: sync 12 commit(s) from upstream stablyai/orca@main')
  })

  it('exits non-zero when the branch state was never measured', () => {
    const result = run(['--behind', '12', '--dropped', '', '--conflicts', 'false'])
    expect(result.status).toBe(1)
    expect(result.outputs.action).toBe('withdraw')
  })

  it('reads the retained-workflow diffstat from the file the sync step wrote', () => {
    const discardFile = join(dir, 'discard.txt')
    writeFileSync(discardFile, ' .github/workflows/pr.yml | 4 +-\n', 'utf8')
    const result = run([
      '--behind',
      '12',
      '--dropped',
      '0',
      '--conflicts',
      'false',
      '--workflow-commits',
      '2',
      '--workflow-discard-file',
      discardFile
    ])
    expect(result.body).toContain('2 upstream commit(s) touched')
    expect(result.body).toContain('.github/workflows/pr.yml')
  })

  it('tolerates a missing diffstat file, which is what an empty retention leaves', () => {
    const result = run([
      '--behind',
      '12',
      '--dropped',
      '0',
      '--conflicts',
      'false',
      '--workflow-discard-file',
      join(dir, 'absent.txt')
    ])
    expect(result.status).toBe(0)
    expect(result.body).not.toContain('<details>')
  })
})
