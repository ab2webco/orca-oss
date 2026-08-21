import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

// Wiring only. The verdict's behaviour is proven in upstream-sync-pr-gate.test.mjs;
// this file guards the workflow facts that verdict is worthless without — a gate
// the YAML never consults is a gate that does not exist.
const sync = parse(readFileSync('.github/workflows/upstream-sync.yml', 'utf8')).jobs.sync
const step = (name) => sync.steps.find((candidate) => candidate.name === name)
const stepIndex = (name) => sync.steps.findIndex((candidate) => candidate.name === name)
const prepare = step('Prepare sync branch')
const gate = step('Decide whether the sync branch may be proposed')
const open = step('Open or update sync PR')
const withdraw = step('Withdraw the PR the sync branch cannot support')

describe('the upstream sync branch preparation', () => {
  it('measures the base commits the pushed branch would delete', () => {
    expect(prepare.run).toContain(
      'dropped="$(git rev-list --count "${sync_branch}..origin/${base}")"'
    )
    expect(prepare.run).toContain('echo "dropped=$dropped" >>"$GITHUB_OUTPUT"')
  })

  it('measures after the push, so the number describes what reviewers can see', () => {
    expect(prepare.run.indexOf('git push -f origin "$sync_branch"')).toBeLessThan(
      prepare.run.indexOf('dropped="$(git rev-list')
    )
  })

  it('restores the fork tree, without which the gate script is not on disk', () => {
    expect(prepare.run).toContain('git checkout --force --detach "origin/${base}"')
    expect(stepIndex('Prepare sync branch')).toBeLessThan(
      stepIndex('Decide whether the sync branch may be proposed')
    )
  })
})

describe('the sync PR gate', () => {
  it('runs the decision script the tests cover', () => {
    expect(gate.run).toContain('node config/scripts/decide-upstream-sync-pr.mjs')
    expect(gate.id).toBe('gate')
  })

  it('feeds it the measurement and the route the branch took', () => {
    expect(gate.run).toContain('--dropped "${{ steps.merge.outputs.dropped }}"')
    expect(gate.run).toContain('--conflicts "${{ steps.merge.outputs.conflicts }}"')
    expect(gate.run).toContain('--behind "${{ steps.check.outputs.behind }}"')
  })

  it('names the body file both gh steps read, so no step writes its own body', () => {
    expect(gate.run).toContain('--body-file "${RUNNER_TEMP}/sync-pr-body.md"')
    for (const gh of [open, withdraw]) {
      expect(gh.run).toContain('${RUNNER_TEMP}/sync-pr-body.md')
    }
  })
})

describe('the pull request the gate authorises', () => {
  // The mutation this file exists to catch: drop these conditions and the daily
  // mirror push proposes a PR that reverts the fork.
  it('opens or updates a PR only on an open verdict', () => {
    expect(open.if).toBe("steps.gate.outputs.action == 'open'")
    expect(open.run).toContain('gh pr create')
  })

  it('closes the PR the branch can no longer support on a withdraw verdict', () => {
    expect(withdraw.if).toBe("steps.gate.outputs.action == 'withdraw'")
    expect(withdraw.run).toContain('gh pr close')
    expect(withdraw.run).not.toContain('gh pr create')
  })

  it('never opens and withdraws in the same run', () => {
    expect(open.if).not.toBe(withdraw.if)
  })

  // `gh pr view <branch>` resolves closed PRs too, so its exit code cannot tell
  // "a PR to update" from "a PR someone already closed".
  it.each([
    ['Open or update sync PR', open],
    ['Withdraw the PR the sync branch cannot support', withdraw]
  ])('decides %s from the PR state, not from gh exit codes', (_name, gh) => {
    expect(gh.run).toContain('gh pr view "$head" --json state --jq .state')
    expect(gh.run).toContain('if [[ "$state" == "OPEN" ]]; then')
  })

  it('keeps every gh call pointed at the fork, not at the upstream remote', () => {
    for (const gh of [open, withdraw]) {
      expect(gh.env.GH_REPO).toBe('${{ github.repository }}')
      expect(gh.env.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}')
    }
  })
})
