import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'

// Runs the real mac packaging step under the env GitHub hands it, with electron-builder
// swapped for a probe that resolves CSC_LINK exactly as MacPackager does (ORCA-640).
const repoRoot = process.cwd()
const release = parse(readFileSync('.github/workflows/lab-release.yml', 'utf8'))
const macJob = release.jobs.mac
const packageStep = macJob.steps.find((step) => step.name === 'Package and publish macOS artifacts')

const probeSource = `
const { writeFileSync } = require('node:fs')
// Why the index first: platformPackager.js alone hits a circular import with linuxPackager.js.
require(${JSON.stringify(resolve('node_modules/app-builder-lib'))})
const { chooseNotNull } = require(${JSON.stringify(resolve('node_modules/app-builder-lib/out/platformPackager.js'))})
const { importCertificate } = require(${JSON.stringify(resolve('node_modules/app-builder-lib/out/codeSign/codesign.js'))})
const config = require(${JSON.stringify(resolve('config/electron-builder.config.cjs'))})
async function main() {
  const cscLink = chooseNotNull(chooseNotNull(config.cscLink, config.mac.cscLink), process.env.CSC_LINK)
  const record = { args: process.argv.slice(2), cscLink: cscLink ?? null, autoDiscovery: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? null }
  try {
    if (cscLink != null) await importCertificate(cscLink, null, process.cwd())
  } catch (error) {
    record.error = error.message
  }
  writeFileSync(process.env.PROBE_OUT, JSON.stringify(record))
}
main()
`

const scratchDirs = []
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function renderStep(dryRun) {
  const script = packageStep.run.replaceAll('${{ inputs.dry_run }}', String(dryRun))
  expect(script).not.toContain('${{')
  return script
}

// Why every key '' in a dry run: each job env value is `!inputs.dry_run && <secret> || ''`
// (or a release_candidate flag that is off), and GitHub sets an empty result rather than omitting it.
function jobEnv(dryRun) {
  return Object.fromEntries(
    Object.keys(macJob.env).map((key) => [
      key,
      dryRun ? '' : key === 'ORCA_MAC_RELEASE' ? '1' : `real-${key}`
    ])
  )
}

function runPackageStep(dryRun, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-lab-release-mac-'))
  scratchDirs.push(dir)
  const probe = join(dir, 'probe.cjs')
  const out = join(dir, 'probe.json')
  writeFileSync(probe, probeSource)
  writeFileSync(join(dir, 'node'), '#!/usr/bin/env bash\nexit 0\n')
  writeFileSync(
    join(dir, 'pnpm'),
    `#!/usr/bin/env bash\nshift 2\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(probe)} "$@"\n`
  )
  chmodSync(join(dir, 'node'), 0o755)
  chmodSync(join(dir, 'pnpm'), 0o755)
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', renderStep(dryRun)],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        PROBE_OUT: out,
        ...jobEnv(dryRun),
        ...extraEnv
      }
    }
  )
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('lab release mac packaging signing env', () => {
  it('sets every signing input from the job env, so a dry run sees them as empty strings', () => {
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD']) {
      expect(macJob.env[key]).toMatch(/^\$\{\{ !inputs\.dry_run && secrets\.\w+ \|\| '' \}\}$/)
    }
  })

  it('packages a dry run unsigned instead of reading an empty CSC_LINK as the repo root', () => {
    const record = runPackageStep(true)
    expect(record.error).toBeUndefined()
    expect(record.cscLink).toBeNull()
    expect(record.autoDiscovery).toBe('false')
    expect(record.args).toEqual([
      '--config',
      'config/electron-builder.config.cjs',
      '--mac',
      '--publish',
      'never'
    ])
  })

  // ORCA-368: with CSC_LINK set, electron-builder ignores CSC_KEYCHAIN and builds a keychain the image rejects.
  it('signs a real release from the prepared keychain, never from CSC_LINK', () => {
    const record = runPackageStep(false, { CSC_KEYCHAIN: '/tmp/orca-signing.keychain-db' })
    expect(record.error).toBeUndefined()
    expect(record.cscLink).toBeNull()
    expect(record.autoDiscovery).toBeNull()
    expect(record.args.at(-1)).toBe('always')
  })
})
