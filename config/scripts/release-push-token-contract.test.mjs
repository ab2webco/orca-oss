import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowDir = join(projectDir, '.github/workflows')
const THIS_REPO = 'ab2webco/orca-oss'
const PUSH_TO_MAIN = /git push\b[^\n]*(\bHEAD:(refs\/heads\/)?main\b|\borigin main\b)/
const APP_TOKEN_ACTION = /^actions\/create-github-app-token@[0-9a-f]{40}$/
const MAIN_ONLY_ENVIRONMENT = 'lab-release'
// A dry run pushes nothing, and the environment's branch policy would refuse it on any branch but main.
const DRY_RUN_EXEMPT_ENVIRONMENT = "${{ inputs.dry_run != true && 'lab-release' || '' }}"

function jobsPushingToMain() {
  const jobs = []
  for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
    const workflow = parse(readFileSync(join(workflowDir, file), 'utf8'))
    for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
      if ((job.steps ?? []).some((step) => PUSH_TO_MAIN.test(step.run ?? ''))) {
        const gatedTo = /github\.repository == '([^']+)'/.exec(String(job.if ?? ''))?.[1]
        jobs.push({ id: `${file}:${name}`, job, runsHere: !gatedTo || gatedTo === THIS_REPO })
      }
    }
  }
  return jobs
}

const pushingJobs = jobsPushingToMain()
const liveJobs = pushingJobs.filter((j) => j.runsHere)

describe('release push token contract', () => {
  // Why pin the list: a detector that stops matching would pass every check below vacuously.
  it('finds every job that pushes to main', () => {
    expect(liveJobs.map((j) => j.id).sort()).toEqual([
      'lab-release.yml:finalize',
      'lab-release.yml:version'
    ])
    expect(
      pushingJobs
        .filter((j) => !j.runsHere)
        .map((j) => j.id)
        .sort()
    ).toEqual(['readme-downloads-badge.yml:update', 'release-cut.yml:cut'])
  })

  // ORCA-635: main's required-checks ruleset refuses GITHUB_TOKEN; only the release app may bypass it.
  it.each(liveJobs.map((j) => [j.id, j.job]))(
    '%s pushes with the release app token',
    (_id, job) => {
      const steps = job.steps
      const mintIndex = steps.findIndex((s) => APP_TOKEN_ACTION.test(s.uses ?? ''))
      expect(mintIndex, 'create-github-app-token pinned by full SHA').toBeGreaterThanOrEqual(0)
      // Why: repo secrets reach any branch's workflow, so the bypass key must stay in a main-only environment.
      expect([MAIN_ONLY_ENVIRONMENT, DRY_RUN_EXEMPT_ENVIRONMENT]).toContain(job.environment)
      const mint = steps[mintIndex]
      expect(mint.with['client-id']).toBe('${{ secrets.RELEASE_APP_CLIENT_ID }}')
      expect(mint.with['private-key']).toBe('${{ secrets.RELEASE_APP_PRIVATE_KEY }}')
      expect(mint.with['permission-contents']).toBe('write')

      const checkouts = steps
        .map((s, i) => [s, i])
        .filter(([s]) => String(s.uses ?? '').startsWith('actions/checkout@'))
      expect(checkouts.length).toBeGreaterThan(0)
      for (const [checkout, index] of checkouts) {
        expect(index).toBeGreaterThan(mintIndex)
        expect(checkout.with?.token).toBe(`\${{ steps.${mint.id}.outputs.token || github.token }}`)
        expect(checkout.with?.['persist-credentials']).not.toBe(false)
      }
    }
  )

  it('exempts only the version job of a dry run from the main-only environment', () => {
    const environments = Object.fromEntries(liveJobs.map((j) => [j.id, j.job.environment]))
    expect(environments).toEqual({
      'lab-release.yml:finalize': MAIN_ONLY_ENVIRONMENT,
      'lab-release.yml:version': DRY_RUN_EXEMPT_ENVIRONMENT
    })
    // The exemption is safe only while a dry run exits before the push.
    const version = liveJobs.find((j) => j.id === 'lab-release.yml:version').job
    const push = version.steps.find((s) => PUSH_TO_MAIN.test(s.run ?? ''))
    const dryRunExit = push.run.indexOf('exit 0')
    expect(push.run.slice(0, dryRunExit)).toContain(
      'if [[ "${{ inputs.dry_run }}" == "true" ]]; then'
    )
    expect(dryRunExit).toBeLessThan(push.run.search(PUSH_TO_MAIN))
  })

  it.each(liveJobs.map((j) => [j.id, j.job]))(
    '%s warns when the app is not configured',
    (_id, job) => {
      const mint = job.steps.find((s) => APP_TOKEN_ACTION.test(s.uses ?? ''))
      expect(job.env?.RELEASE_APP_CLIENT_ID).toBe('${{ secrets.RELEASE_APP_CLIENT_ID }}')
      expect(mint.if).toBe("env.RELEASE_APP_CLIENT_ID != ''")
      const warn = job.steps.find((s) => s.if === "env.RELEASE_APP_CLIENT_ID == ''")
      expect(warn?.run).toContain('::warning')
    }
  )
})
