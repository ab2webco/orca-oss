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

function signalJobKeys() {
  return decideStep.run.match(/--signal-job (\S+)/g).map((flag) => flag.split(' ')[1])
}

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

  // The implicit success() is false over a skipped ancestor, so a dry run or
  // skip_gate (gate_static/gate_tests skipped) would skip every build behind it.
  it.each(['version', 'mac', 'linux', 'windows', 'finalize'])(
    'runs %s past a skipped gate job, but only when each direct need succeeded',
    (jobKey) => {
      const job = release.jobs[jobKey]
      expect(job.if).toContain('!cancelled()')
      expect(job.if).not.toContain('always()')
      for (const dependency of [job.needs].flat()) {
        expect(job.if).toContain(`needs.${dependency}.result == 'success'`)
      }
    }
  )

  it('never finalizes a dry run', () => {
    expect(release.jobs.finalize.if).toContain('inputs.dry_run != true')
  })

  it('reaches a verdict even when a gate job failed, was cancelled or was skipped', () => {
    expect(verdict.if).toContain('always()')
  })

  it('asks for the actions:read scope the jobs API needs', () => {
    expect(verdict.permissions).toEqual({ contents: 'read', actions: 'read' })
  })

  it('names signal jobs that this workflow actually declares', () => {
    expect(signalJobKeys()).toEqual(['gate_static', 'gate_tests', 'gate_plugin_seal'])
    for (const jobKey of signalJobKeys()) {
      expect(release.jobs[jobKey]).toBeDefined()
    }
  })

  // A count that drifts below what the signal jobs expand to would let a missing
  // shard read as green, so it is derived from those jobs rather than restated.
  it('expects exactly the number of jobs its declared signal jobs expand to', () => {
    const expanded = signalJobKeys()
      .map((jobKey) => {
        const matrix = release.jobs[jobKey].strategy?.matrix
        return matrix
          ? Object.values(matrix).reduce((product, axis) => product * axis.length, 1)
          : 1
      })
      .reduce((total, count) => total + count, 0)
    expect(decideStep.run).toContain(`--expected-jobs ${expanded}`)
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
    for (const jobKey of signalJobKeys()) {
      expect(release.jobs[jobKey].steps[0].with.ref).toBe(pinned)
    }
    // Concurrency serializes releases but does not stop a human push, so the
    // build refuses rather than bumping on top of an unverified commit.
    const guard = release.jobs.version.steps.find(
      (step) => step.name === 'Refuse to release past the verified commit'
    )
    expect(guard.env.VERIFIED_SHA).toBe(pinned)
    expect(guard.run).toContain('git rev-parse HEAD')
    expect(guard.run).toContain('exit 1')
  })

  it('skips the gate only on a dry run or an explicit request', () => {
    const condition = 'inputs.dry_run != true && inputs.skip_gate != true'
    for (const jobKey of signalJobKeys()) {
      expect(release.jobs[jobKey].if).toBe(condition)
    }
  })

  // ORCA-662 shipped because no gate used the packaged app; the PR workflow must run the same check.
  it('checks the packaged plugin seal on every OS, with the action the PR workflow runs', () => {
    const seal = release.jobs.gate_plugin_seal
    const prSeal = parse(readFileSync('.github/workflows/packaged-plugin-seal.yml', 'utf8')).jobs
      .seal
    const action = './.github/actions/verify-packaged-plugin-seal'
    expect(seal.needs).toBe('resolve')
    expect(verdict.needs).toContain('gate_plugin_seal')
    expect(seal.strategy.matrix.os).toEqual(['macos-latest', 'ubuntu-latest', 'windows-latest'])
    expect(seal.strategy.matrix.os).toEqual(prSeal.strategy.matrix.os)
    expect(seal.steps.at(-1).uses).toBe(action)
    expect(prSeal.steps.at(-1).uses).toBe(action)
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
