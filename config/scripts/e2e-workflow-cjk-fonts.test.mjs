import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')

const workflow = parse(readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8'))

const jobRuns = (job) =>
  (job.steps ?? []).map((step) => step.run).filter((run) => typeof run === 'string')

const aptPackages = (job) =>
  jobRuns(job)
    .flatMap((run) => run.match(/apt-get install[^\n]*/g) ?? [])
    .flatMap((install) => install.split(/\s+/))
    .filter((token) => !['apt-get', 'install', '&&', 'sudo', ''].includes(token))
    .filter((token) => !token.startsWith('-'))

describe('e2e workflow CJK font coverage', () => {
  // Why derived and not a hardcoded job list: a new spec-running lane added later
  // would otherwise inherit the tofu problem silently.
  const specRunningJobs = Object.entries(workflow.jobs).filter(([, job]) =>
    jobRuns(job).some((run) => run.includes('test:e2e'))
  )

  // Why sorted and not positional: pinning job order would red-line this on an
  // upstream sync that merely reorders the file. The set is what matters — it also
  // keeps the it.each below from silently covering nothing.
  it('covers every job that executes specs', () => {
    expect(specRunningJobs.map(([name]) => name).sort()).toEqual([
      'changed-e2e',
      'e2e',
      'ssh-docker-watcher-isolation'
    ])
  })

  // Why this is a test and not a comment: ubuntu-latest resolves no Korean-capable
  // font, so a dropped package makes CJK glyph-metric specs measure a tofu box and
  // fail for a reason that has nothing to do with the code under test. e2e.yml
  // conflicts on every upstream sync, which is exactly where the line gets lost.
  it.each(specRunningJobs)('installs fonts-noto-cjk in the %s job', (_name, job) => {
    expect(aptPackages(job)).toContain('fonts-noto-cjk')
  })

  it('does not install fonts in the build job, which runs no specs', () => {
    expect(jobRuns(workflow.jobs.build).some((run) => run.includes('test:e2e'))).toBe(false)
    expect(aptPackages(workflow.jobs.build)).not.toContain('fonts-noto-cjk')
  })
})
