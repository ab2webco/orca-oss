import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

// Wiring only. The verdict's behaviour is proven in release-signal-gate.test.mjs;
// this file guards the workflow facts that verdict cannot work without — and the
// parity that keeps the gate's suite from drifting away from the PR suite.
const release = parse(readFileSync('.github/workflows/lab-release.yml', 'utf8'))
const pr = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
const verdict = release.jobs.gate
const decideStep = verdict.steps.at(-1)

function needsClosure(jobKey) {
  const seen = new Set()
  const queue = [jobKey]
  while (queue.length > 0) {
    const current = queue.pop()
    for (const dependency of [release.jobs[current]?.needs ?? []].flat()) {
      if (!seen.has(dependency)) {
        seen.add(dependency)
        queue.push(dependency)
      }
    }
  }
  return seen
}

describe('the lab release signal gate', () => {
  it.each(['version', 'mac', 'linux', 'windows', 'finalize'])(
    'stands between the resolved commit and %s',
    (jobKey) => {
      expect(needsClosure(jobKey)).toContain('gate')
    }
  )

  it('reaches a verdict even when a gate job failed, was cancelled or was skipped', () => {
    expect(verdict.if).toContain('always()')
  })

  it('asks for the actions:read scope the jobs API needs', () => {
    expect(verdict.permissions).toEqual({ contents: 'read', actions: 'read' })
  })

  it('names signal jobs that this workflow actually declares', () => {
    const declared = decideStep.run.match(/--signal-job (\S+)/g).map((flag) => flag.split(' ')[1])
    expect(declared).toEqual(['gate_static', 'gate_tests'])
    for (const jobKey of declared) {
      expect(release.jobs[jobKey]).toBeDefined()
    }
  })

  // A count that drifts below the matrix would let a missing shard read as green.
  it('expects exactly the number of jobs the gate declares', () => {
    const shards = release.jobs.gate_tests.strategy.matrix.shard.length
    expect(decideStep.run).toContain(`--expected-jobs ${shards + 1}`)
  })

  it('runs the same shard command and shard count as the PR suite', () => {
    const gateShard = release.jobs.gate_tests.steps.at(-1)
    const prShard = pr.jobs.test.steps.at(-1)
    expect(gateShard.name).toBe('Test shard')
    expect(prShard.name).toBe('Test shard')
    expect(gateShard.run).toBe(prShard.run)
    expect(release.jobs.gate_tests.strategy.matrix.shard).toEqual(
      pr.jobs.test.strategy.matrix.shard
    )
    expect(release.jobs.gate_tests.strategy.matrix.shard_total).toEqual(
      pr.jobs.test.strategy.matrix.shard_total
    )
    expect(release.jobs.gate_tests['timeout-minutes']).toBe(pr.jobs.test['timeout-minutes'])
  })

  it('verifies the one pinned commit and refuses to release past it', () => {
    const pinned = '${{ needs.resolve.outputs.sha }}'
    expect(release.jobs.gate_static.steps[0].with.ref).toBe(pinned)
    expect(release.jobs.gate_tests.steps[0].with.ref).toBe(pinned)
    // Concurrency serializes releases but does not stop a human push, so the
    // build refuses rather than bumping on top of an unverified commit.
    const guard = release.jobs.version.steps[1]
    expect(guard.env.VERIFIED_SHA).toBe(pinned)
    expect(guard.run).toContain('git rev-parse HEAD')
    expect(guard.run).toContain('exit 1')
  })

  it('skips the gate only on a dry run or an explicit request', () => {
    const condition = 'inputs.dry_run != true && inputs.skip_gate != true'
    expect(release.jobs.gate_static.if).toBe(condition)
    expect(release.jobs.gate_tests.if).toBe(condition)
  })

  it('offers the escape hatch with the reason field that makes it auditable', () => {
    const inputs = release.on.workflow_dispatch.inputs
    expect(inputs.skip_gate.default).toBe(false)
    expect(inputs.skip_gate_reason).toBeDefined()
  })

  it('carries the verdict and the verified commit into the release notes', () => {
    const notes = release.jobs.finalize.steps.find((step) =>
      step.name?.startsWith('Set title, notes')
    )
    expect(notes.env.GATE_REASON).toBe('${{ needs.gate.outputs.reason }}')
    expect(notes.env.VERIFIED_SHA).toBe('${{ needs.resolve.outputs.sha }}')
    expect(notes.run).toContain('${VERIFIED_SHA}')
    expect(notes.run).toContain('${GATE_REASON}')
  })
})
