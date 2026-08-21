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

  // The job installs nothing, so a dependency added to either file would only fail
  // at 12:00 UTC, after the branch is already pushed.
  it.each(['decide-upstream-sync-pr.mjs', 'upstream-sync-pr-gate.mjs'])(
    'keeps %s runnable on a bare node, importing builtins and siblings only',
    (file) => {
      const source = readFileSync(`config/scripts/${file}`, 'utf8')
      const specifiers = [...source.matchAll(/^import .* from '([^']+)'$/gm)].map(
        (match) => match[1]
      )
      expect(specifiers.filter((specifier) => !/^(node:|\.\/)/.test(specifier))).toEqual([])
      expect(sync.steps.some((candidate) => candidate.uses?.startsWith('actions/setup-node'))).toBe(
        false
      )
    }
  )

  it('reaches the verdict through the module the unit tests exercise', () => {
    const cli = readFileSync('config/scripts/decide-upstream-sync-pr.mjs', 'utf8')
    expect(cli).toContain("from './upstream-sync-pr-gate.mjs'")
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

  // The branch permanently carries closed PRs, and `gh pr view <branch>` picks one
  // of them by an order neither documented nor tested. Asking for open PRs only
  // leaves nothing to guess, and acts on the number rather than the branch name.
  it.each([
    ['Open or update sync PR', open],
    ['Withdraw the PR the sync branch cannot support', withdraw]
  ])('finds the PR for %s by asking only for open ones', (_name, gh) => {
    expect(gh.run).toContain(
      `number="$(gh pr list --head "$head" --state open --json number --jq '.[0].number // empty')"`
    )
    expect(gh.run).toContain('if [[ -n "$number" ]]; then')
    expect(gh.run).not.toContain('gh pr view')
  })

  it('keeps every gh call pointed at the fork, not at the upstream remote', () => {
    for (const gh of [open, withdraw]) {
      expect(gh.env.GH_REPO).toBe('${{ github.repository }}')
      expect(gh.env.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}')
    }
  })
})
