import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// The fallback for a PPA that is added but serves no packages (ORCA-732). The network,
// sudo and /usr/local/bin are all injected, so the test drives every outcome offline.

const SCRIPT = path.resolve(import.meta.dirname, 'install-fish4-release.sh')

/** A release tarball holding a stand-in `fish` that reports `version`. */
function releaseTarball(dir, version) {
  const stage = mkdtempSync(path.join(dir, 'stage-'))
  writeFileSync(path.join(stage, 'fish'), `#!/bin/sh\necho "fish, version ${version}"\n`, {
    mode: 0o755
  })
  const tarball = path.join(dir, 'fish.tar.xz')
  execFileSync('tar', ['-cJf', tarball, '-C', stage, 'fish'])
  return { tarball, sha256: createHash('sha256').update(readFileSync(tarball)).digest('hex') }
}

function run({ installed, release = '4.9.3', sha256, isDownloadDown = false }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-fish4-release-'))
  const { tarball, sha256: real } = releaseTarball(dir, release)
  const installDir = mkdtempSync(path.join(dir, 'bin-'))
  const statusFile = path.join(dir, 'fish4-source-status')
  writeFileSync(statusFile, 'ppa\n', 'utf8')
  const fake = mkdtempSync(path.join(dir, 'fake-'))
  // Why a fake sudo that just runs its command: the runner's sudo is passwordless, a test machine's is not.
  writeFileSync(path.join(fake, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 })
  const download = path.join(fake, 'download')
  writeFileSync(
    download,
    isDownloadDown
      ? '#!/usr/bin/env bash\necho "curl: (22) The requested URL returned error: 503" >&2\nexit 22\n'
      : `#!/usr/bin/env bash\ncp ${JSON.stringify(tarball)} "$1"\n`,
    { mode: 0o755 }
  )
  const versionCommand = installed === null ? 'false' : `echo fish, version ${installed}`
  let status = 0
  let output = ''
  try {
    output = execFileSync('bash', ['-c', `bash ${JSON.stringify(SCRIPT)} 2>&1`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${fake}:${process.env.PATH}`,
        ORCA_FISH4_VERSION_COMMAND: versionCommand,
        ORCA_FISH4_SOURCE_STATUS_FILE: statusFile,
        ORCA_FISH4_INSTALL_DIR: installDir,
        ORCA_FISH4_DOWNLOAD_COMMAND: download,
        ORCA_FISH4_RELEASE_SHA256: sha256 ?? real
      }
    })
  } catch (error) {
    status = error.status
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  const shipped = path.join(installDir, 'fish')
  let shippedVersion = null
  try {
    shippedVersion = execFileSync(shipped, ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    shippedVersion = null
  }
  return { status, output, recorded: readFileSync(statusFile, 'utf8').trim(), shippedVersion }
}

describe('install-fish4-release fallback', () => {
  it('installs the pinned fish 4 release when apt left fish 3.7', () => {
    const result = run({ installed: '3.7.0' })
    expect(result.status).toBe(0)
    expect(result.shippedVersion).toBe('fish, version 4.9.3')
    expect(result.recorded).toBe('release')
  })

  it('installs it when apt installed no fish at all', () => {
    const result = run({ installed: null })
    expect(result.status).toBe(0)
    expect(result.recorded).toBe('release')
  })

  it('does nothing when apt already installed fish 4', () => {
    const result = run({ installed: '4.0.2' })
    expect(result.status).toBe(0)
    expect(result.shippedVersion).toBeNull()
    expect(result.recorded).toBe('ppa')
  })

  it('refuses a tarball whose SHA-256 is not the pinned one, installing nothing', () => {
    const result = run({ installed: '3.7.0', sha256: '0'.repeat(64) })
    expect(result.status).not.toBe(0)
    expect(result.shippedVersion).toBeNull()
    expect(result.recorded).toBe('release-checksum-mismatch')
  })

  it('reports the release source unavailable when the download fails', () => {
    const result = run({ installed: '3.7.0', isDownloadDown: true })
    expect(result.status).toBe(75)
    expect(result.shippedVersion).toBeNull()
    expect(result.recorded).toBe('release-unavailable')
  })

  it('does not record success for a release that is not fish 4', () => {
    const result = run({ installed: '3.7.0', release: '3.7.1' })
    expect(result.status).not.toBe(0)
    expect(result.recorded).toBe('release-not-fish4')
  })

  it('pins a published fish 4 release by version and SHA-256', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    expect(script).toMatch(
      /releases\/download\/\$\{RELEASE\}\/fish-\$\{RELEASE\}-linux-x86_64\.tar\.xz/
    )
    expect(script).toMatch(/readonly RELEASE='4\.\d+\.\d+'/)
    expect(script).toMatch(/[0-9a-f]{64}/)
  })

  it('runs in pr.yml after the apt install and before the version gate', () => {
    const workflow = readFileSync(
      path.resolve(import.meta.dirname, '..', '..', '.github', 'workflows', 'pr.yml'),
      'utf8'
    )
    const apt = workflow.indexOf('bash config/scripts/ci-apt.sh install -y zsh fish')
    const fallback = workflow.indexOf('bash config/scripts/install-fish4-release.sh')
    const gate = workflow.indexOf('bash config/scripts/require-fish4.sh')
    expect(apt).toBeGreaterThan(-1)
    expect(fallback).toBeGreaterThan(apt)
    expect(gate).toBeGreaterThan(fallback)
  })
})

// ORCA-737: the PPA index answered but its fish .deb 503'd, apt exited 100, and `bash -e`
// ended the step before the fallback. So the step body itself runs here, against a fake apt.
describe('pr.yml "Install zsh and fish" step', () => {
  const workflow = parse(
    readFileSync(
      path.resolve(import.meta.dirname, '..', '..', '.github', 'workflows', 'pr.yml'),
      'utf8'
    )
  )
  const body = workflow.jobs.shell_contracts.steps.find(
    (step) => step.name === 'Install zsh and fish'
  ).run

  function runStep({ isFishDebDown, isZshDown = false }) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-fish4-step-'))
    const calls = path.join(dir, 'calls.log')
    const scripts = path.join(dir, 'config', 'scripts')
    mkdirSync(scripts, { recursive: true })
    for (const name of ['enable-fish4-apt-source.sh', 'install-fish4-release.sh']) {
      writeFileSync(path.join(scripts, name), `echo ${name} >>${JSON.stringify(calls)}\n`)
    }
    writeFileSync(
      path.join(scripts, 'ci-apt.sh'),
      readFileSync(path.resolve(import.meta.dirname, 'ci-apt.sh'))
    )
    const fake = mkdtempSync(path.join(dir, 'fake-'))
    writeFileSync(path.join(fake, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
    writeFileSync(path.join(fake, 'timeout'), '#!/usr/bin/env bash\nshift 3\nexec "$@"\n', {
      mode: 0o755
    })
    writeFileSync(path.join(fake, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 })
    writeFileSync(
      path.join(fake, 'apt-get'),
      `#!/usr/bin/env bash
echo "$*" >>${JSON.stringify(calls)}
case "$*" in
  *install*fish*) ${isFishDebDown ? 'echo "E: Failed to fetch fish.deb  503" >&2; exit 100' : 'exit 0'} ;;
  *install*zsh*) ${isZshDown ? 'exit 100' : 'exit 0'} ;;
esac
exit 0
`,
      { mode: 0o755 }
    )
    let status = 0
    try {
      execFileSync('bash', ['-e', '-c', body], {
        cwd: dir,
        stdio: 'ignore',
        env: { ...process.env, PATH: `${fake}:${process.env.PATH}`, RUNNER_TEMP: dir }
      })
    } catch (error) {
      status = error.status
    }
    return { status, calls: readFileSync(calls, 'utf8') }
  }

  it('still runs the fish 4 release fallback when the PPA fish .deb fails to download', () => {
    const { status, calls } = runStep({ isFishDebDown: true })
    expect(status).toBe(0)
    expect(calls).toContain('install-fish4-release.sh')
  })

  it('stays fatal when zsh cannot be installed', () => {
    const { status } = runStep({ isFishDebDown: true, isZshDown: true })
    expect(status).not.toBe(0)
  })

  it('runs the fallback on the ordinary path too', () => {
    const { status, calls } = runStep({ isFishDebDown: false })
    expect(status).toBe(0)
    expect(calls).toContain('install-fish4-release.sh')
  })
})
