import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const APT_ACTION = './.github/actions/install-apt-packages'

const workflow = parse(readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8'))
const readAction = () =>
  parse(readFileSync(join(projectDir, '.github/actions/install-apt-packages/action.yml'), 'utf8'))

const specRunningJobs = Object.entries(workflow.jobs).filter(([, job]) =>
  (job.steps ?? []).some((step) => step.run?.includes('test:e2e'))
)

describe('e2e workflow apt installs', () => {
  // Why: on 2026-10-22 the Azure mirror served fonts-noto-cjk (61 MB) at ~40 kB/s
  // and the install alone took 24-27 min of a 45 min shard (ORCA-750).
  it.each(specRunningJobs)('installs packages through the cached action in %s', (_name, job) => {
    const steps = job.steps ?? []
    expect(steps.some((step) => step.uses === APT_ACTION)).toBe(true)
    expect(steps.filter((step) => /apt-get install/.test(step.run ?? ''))).toEqual([])
  })

  it('uses the same bounded cached action in the build job', () => {
    const install = workflow.jobs.build.steps.find(
      (step) => step.name === 'Install native build tools'
    )
    expect(install.uses).toBe(APT_ACTION)
    expect(install.with.packages).toBe('build-essential python3')
  })

  it('installs from a restored archive dir and saves it only on a miss', () => {
    const steps = readAction().runs.steps
    const restore = steps.findIndex((step) => step.uses?.startsWith('actions/cache/restore@'))
    const install = steps.findIndex((step) => /Dir::Cache::Archives=/.test(step.run ?? ''))
    const save = steps.findIndex((step) => step.uses?.startsWith('actions/cache/save@'))

    expect(restore).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(restore)
    expect(save).toBeGreaterThan(install)
    expect(steps[save].if).toContain("cache-hit != 'true'")
  })
})
