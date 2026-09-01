import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(
    fileURLToPath(new URL('../../.github/workflows/mobile-android-release.yml', import.meta.url)),
    'utf8'
  )
)

const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
const scripts = steps.filter((step) => typeof step.run === 'string').map((step) => step.run)

describe('mobile android release artifacts', () => {
  // Why the bundle and not just the APK: Play has required an App Bundle for new apps
  // since 2021, so an APK-only pipeline cannot reach the store at all.
  it('builds an App Bundle', () => {
    expect(scripts.some((run) => run.includes('bundleRelease'))).toBe(true)
  })

  it('publishes the bundle wherever it publishes the APK', () => {
    const publishing = scripts.filter((run) => run.includes('apk/release/*.apk'))
    expect(publishing.length).toBeGreaterThan(0)
    for (const run of publishing) {
      expect(run).toContain('bundle/release/*.aab')
    }
  })

  // Why: a build that falls back to the debug keystore still produces an installable file,
  // so "an artifact exists" proves nothing about whether Play will take it.
  it('prints the signer of what it built', () => {
    expect(scripts.some((run) => run.includes('keytool -printcert'))).toBe(true)
  })
})
