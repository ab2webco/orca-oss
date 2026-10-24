import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const sweepScript = join(projectDir, '.claude/hooks/coordinator-sweep.sh')
const tempDirs = []

function writeStub(bin, name, body) {
  const path = join(bin, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/**
 * A repo whose feature branch has a live terminal and commits main lacks
 * (the shape a squash-merged branch leaves behind), with its PR reported MERGED.
 */
function makeMergedBranchFixture({ basedOnPr = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orca-sweep-repo-'))
  const bin = mkdtempSync(join(tmpdir(), 'orca-sweep-bin-'))
  tempDirs.push(root, bin)
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t'
      }
    })

  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  const worktree = join(root, 'wt-merged')
  git('worktree', 'add', '-q', '-b', 'feat/merged-squash', worktree)
  git('-C', worktree, 'commit', '-q', '--allow-empty', '-m', 'squashed work')

  writeStub(
    bin,
    'orca',
    `#!/bin/sh
case "$*" in
  *"terminal list"*) cat <<'JSON'
{"ok":true,"result":{"terminals":[{"liveness":"running","worktreePath":"${worktree}"}]}}
JSON
  ;;
  *) echo '{"ok":true}' ;;
esac
`
  )
  writeStub(
    bin,
    'gh',
    `#!/bin/sh
case "$*" in
  *"--state merged"*) echo 6 ;;
  ${basedOnPr ? `*mergeStateStatus*) echo '[{"number":${basedOnPr},"mergeStateStatus":"CLEAN","statusCheckRollup":[],"baseRefName":"feat/merged-squash"}]' ;;` : ''}
  *) true ;;
esac
`
  )
  return { root, bin }
}

function sweepLine({ root, bin }) {
  const result = spawnSync('bash', [sweepScript, '--tick'], {
    encoding: 'utf8',
    cwd: projectDir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ORCA_SWEEP_ROOT: root }
  })
  const line = (result.stdout || '').split('\n').find((l) => l.startsWith('SWEEP'))
  expect(line, result.stderr).toBeTruthy()
  return line
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('coordinator-sweep leftover worktrees', () => {
  // The defect: a squash-merged branch with a live terminal was hidden as "in use",
  // so its worktree never showed up as leftover after the PR merged.
  it('flags a merged branch even while a terminal is still open on it', () => {
    const line = sweepLine(makeMergedBranchFixture())
    expect(line).toMatch(/leftover-worktrees:.*merged-squash/)
  })

  // The defect: the coordinator deletes a leftover branch that an open PR is based on,
  // and GitHub then closes that PR. The line must name the PR so nobody deletes it blind.
  it('names the open PR based on a leftover branch', () => {
    const line = sweepLine(makeMergedBranchFixture({ basedOnPr: 7 }))
    expect(line).toMatch(/leftover-worktrees:.*merged-squash\(base-de-#7\)/)
  })
})
