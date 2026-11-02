import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

// ORCA-932: GitHub Free caps the org at 20 concurrent jobs, and each PR push used to
// schedule ~45. A push now runs the fast set; the rest runs once, in the merge queue.
const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const locWorkflow = parse(readFileSync('.github/workflows/pr-test-loc.yml', 'utf8'))
const sealWorkflow = parse(readFileSync('.github/workflows/packaged-plugin-seal.yml', 'utf8'))
const e2eWorkflow = parse(readFileSync('.github/workflows/e2e.yml', 'utf8'))

const MERGE_QUEUE_ONLY = "github.event_name == 'merge_group'"
const MERGE_QUEUE_JOBS = [
  'git_compatibility',
  'shell_contracts',
  'cli_subprocess',
  'cross-version-wire',
  'managed_hook_node18',
  'claude_hooks_python_floor',
  'package',
  'verify-windows',
  'package_windows'
]
const PER_PUSH_JOBS = [
  'static_analysis',
  'root_directory_guard',
  'typecheck',
  'test',
  'e2e-paths',
  'e2e',
  'verify',
  'ci_failure_class'
]

const verifyStep = workflow.jobs.verify.steps.find(
  (step) => step.name === 'Require successful checks'
)

function verifyExitCode(eventName, overrides) {
  const env = { ...process.env, DRAFT: 'false', EVENT_NAME: eventName }
  for (const job of workflow.jobs.verify.needs) {
    env[job.toUpperCase().replaceAll('-', '_')] = 'success'
  }
  return spawnSync('bash', ['-c', verifyStep.run], {
    env: { ...env, ...overrides }
  }).status
}

// The shard matrix is an expression per event; evaluate it the way Actions would.
function shardsFor(eventName) {
  const expression = workflow.jobs.test.strategy.matrix.shard
  const match = expression.match(
    /github\.event_name == 'merge_group' && fromJSON\('(\[[^']*\])'\) \|\| fromJSON\('(\[[^']*\])'\)/
  )
  expect(match, expression).not.toBeNull()
  return JSON.parse(eventName === 'merge_group' ? match[1] : match[2])
}

describe('PR checks split between the push and the merge queue', () => {
  it('runs on pull request pushes and on merge queue entries', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request', 'merge_group'])
    expect(workflow.on.merge_group).toEqual({ types: ['checks_requested'] })
  })

  it('keys concurrency so a merge group never cancels another one', () => {
    // A merge group has no pull_request payload; its ref is unique per queue entry.
    expect(workflow.concurrency.group).toBe(
      'pr-checks-${{ github.event.pull_request.number || github.ref }}'
    )
  })

  it('leaves the full set to the merge queue', () => {
    for (const job of MERGE_QUEUE_JOBS) {
      expect(workflow.jobs[job].if, job).toBe(MERGE_QUEUE_ONLY)
    }
  })

  it('keeps the fast set on every push', () => {
    for (const job of PER_PUSH_JOBS) {
      expect(String(workflow.jobs[job].if ?? ''), job).not.toContain('event_name')
    }
    expect([...MERGE_QUEUE_JOBS, ...PER_PUSH_JOBS].sort()).toEqual(
      Object.keys(workflow.jobs).sort()
    )
  })

  it('shards unit tests 8 ways on a push and 16 ways in the merge queue', () => {
    expect(shardsFor('pull_request')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(shardsFor('merge_group')).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(workflow.jobs.test.strategy.matrix.shard_total).toBe(
      "${{ github.event_name == 'merge_group' && fromJSON('[16]') || fromJSON('[8]') }}"
    )
    // Half the shards each carry twice the tests; a healthy shard took under 5 minutes at 16.
    expect(workflow.jobs.test['timeout-minutes']).toBe(25)
  })

  it('schedules fewer than 20 jobs for an ordinary PR push', () => {
    // Upper bound: every per-push job, the fork's one Node major, and the changed-specs E2E
    // lane (its build plus one runner). The full E2E lane only runs in the merge queue.
    const changedSpecsLane = Object.values(e2eWorkflow.jobs).filter(
      (job) => job.if === "inputs.test_files != ''" || !job.if
    ).length
    let count = 0
    for (const job of PER_PUSH_JOBS) {
      if (job === 'test') {
        count += shardsFor('pull_request').length
      } else if (job === 'e2e') {
        count += changedSpecsLane
      } else {
        count += 1
      }
    }
    count += Object.keys(locWorkflow.jobs).length
    expect(changedSpecsLane).toBe(2)
    expect(count).toBeLessThan(20)
  })

  it('defers the full E2E suite to the merge queue on a push', () => {
    const filterStep = workflow.jobs['e2e-paths'].steps.find(
      (step) => step.name === 'Select E2E scope'
    )
    expect(filterStep.env.EVENT_NAME).toBe('${{ github.event_name }}')
    expect(filterStep.run).toContain('--defer-full-suite')
    expect(filterStep.env.BASE_SHA).toBe(
      '${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}'
    )
    expect(filterStep.env.HEAD_SHA).toBe(
      '${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha }}'
    )
  })

  it('moves the packaged plugin seal to the merge queue', () => {
    expect(Object.keys(sealWorkflow.on).sort()).toEqual(['merge_group', 'workflow_dispatch'])
    expect(sealWorkflow.jobs.seal.needs).toBe('scope')
    expect(sealWorkflow.jobs.seal.if).toBe("needs.scope.outputs.should_run == 'true'")
  })

  describe.skipIf(process.platform === 'win32')('plugin seal scope in the merge queue', () => {
    const filterStep = sealWorkflow.jobs.scope.steps.find(
      (step) => step.name === 'Match the plugin seal paths'
    )

    // Replays the step with `git diff` stubbed to print the given paths.
    function sealScope(eventName, paths) {
      const dir = mkdtempSync(join(tmpdir(), 'orca-seal-scope-'))
      try {
        const output = join(dir, 'out')
        writeFileSync(
          join(dir, 'git'),
          `#!/bin/sh\nprintf '%s\\n' ${paths.map((p) => `'${p}'`).join(' ')}\n`
        )
        chmodSync(join(dir, 'git'), 0o755)
        const result = spawnSync('bash', ['-c', filterStep.run], {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            GITHUB_OUTPUT: output,
            EVENT_NAME: eventName,
            BASE_SHA: 'base',
            HEAD_SHA: 'head'
          }
        })
        expect(result.status).toBe(0)
        return readFileSync(output, 'utf8')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it.each([
      ['src/main/claude/orchestrator-game-plugin.ts', true],
      ['src/main/claude/claude-plugin-dir-probe.test.ts', true],
      ['resources/claude-plugins/orca-game/plugin.json', true],
      ['config/electron-builder.config.cjs', true],
      ['config/scripts/verify-packaged-claude-plugin-seal.mjs', true],
      ['.github/actions/verify-packaged-plugin-seal/action.yml', true],
      ['.github/workflows/packaged-plugin-seal.yml', true],
      ['src/main/claude/statusline-script.ts', false],
      ['docs/reference/ci-merge-queue.md', false]
    ])('%s runs the seal: %s', (path, expected) => {
      expect(sealScope('merge_group', [path])).toBe(`should_run=${expected}\n`)
    })

    it('fails instead of skipping when the diff cannot be read', () => {
      const result = spawnSync('bash', ['-c', filterStep.run], {
        env: {
          ...process.env,
          EVENT_NAME: 'merge_group',
          GITHUB_OUTPUT: '/dev/null',
          BASE_SHA: '0000000',
          HEAD_SHA: '0000001'
        }
      })
      expect(result.status).not.toBe(0)
    })

    it('always runs on a manual dispatch', () => {
      expect(sealScope('workflow_dispatch', ['docs/x.md'])).toBe('should_run=true\n')
    })
  })

  describe.skipIf(process.platform === 'win32')('verify verdict per event', () => {
    const skippedFullSet = Object.fromEntries(
      MERGE_QUEUE_JOBS.filter((job) => workflow.jobs.verify.needs.includes(job)).map((job) => [
        job.toUpperCase().replaceAll('-', '_'),
        'skipped'
      ])
    )

    it.each([
      ['pull_request', skippedFullSet, 0, 'a push leaves the full set to the queue'],
      ['merge_group', skippedFullSet, 1, 'the queue cannot skip the full set'],
      ['merge_group', {}, 0, 'the queue ran the full set green'],
      ['merge_group', { PACKAGE_WINDOWS: 'failure' }, 1, 'a red full-set job in the queue'],
      ['pull_request', { PACKAGE: 'failure' }, 1, 'a full-set job that ran red on a push'],
      ['pull_request', { ...skippedFullSet, TEST: 'skipped' }, 1, 'a fast job cannot skip'],
      ['merge_group', { E2E: 'skipped' }, 0, 'the queue scoped E2E out']
    ])('%s %j exits %i (%s)', (eventName, overrides, expected) => {
      expect(verifyExitCode(eventName, overrides)).toBe(expected)
    })
  })
})
