import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const HOOK = path.join(process.cwd(), '.claude/hooks/post-merge-board-close.py')

/** Runs the hook with `gh` and `orca` replaced by scripts that record their argv. */
function run(command, { state = 'MERGED', title = 'fix: algo (ORCA-99)', statusOk = true } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'board-close-'))
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh\necho '{"state":"${state}","title":"${title}"}'\n`,
    { mode: 0o755 }
  )
  fs.writeFileSync(
    path.join(bin, 'orca'),
    `#!/bin/sh\necho "$@" >> ${bin}/calls\n[ "$2" = "status" ] && exit ${statusOk ? 0 : 1}\nexit 0\n`,
    { mode: 0o755 }
  )
  const stdout = execFileSync('python3', [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8'
  })
  const calls = fs.existsSync(path.join(bin, 'calls'))
    ? fs.readFileSync(path.join(bin, 'calls'), 'utf8')
    : ''
  fs.rmSync(bin, { recursive: true, force: true })
  return { stdout, calls }
}

describe('closing the ticket a merge delivered', () => {
  it('moves it to Done and says which PR did it', () => {
    const { stdout, calls } = run('gh pr merge 12 -R x/y --squash')

    expect(calls).toContain('status set --id ORCA-99')
    expect(calls).toContain('--to Done')
    expect(stdout).toContain('ORCA-99')
  })

  it('says it could not move it rather than claiming it did', () => {
    const { stdout } = run('gh pr merge 12 --squash', { statusOk: false })

    expect(stdout).toContain('no pude mover')
    expect(stdout).not.toContain('→ Done')
  })
})

describe('what must not close a ticket', () => {
  it('leaves it alone when the PR is not actually merged', () => {
    // Why: the command can fail or be denied. Closing on a merge that never
    // happened makes the board lie in the other direction.
    const { calls } = run('gh pr merge 12 --squash', { state: 'OPEN' })

    expect(calls).not.toContain('status set')
  })

  it('ignores the merge command quoted inside another command', () => {
    // Why: `\b` matching is how board-state-guard denied file writes (ORCA-432).
    const { calls } = run('echo "run gh pr merge 12 later" >> notes.md')

    expect(calls).toBe('')
  })

  it('does nothing when the PR title names no ticket', () => {
    const { calls } = run('gh pr merge 12 --squash', { title: 'chore: sin ticket' })

    expect(calls).not.toContain('status set')
  })
})
