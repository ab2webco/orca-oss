import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import {
  GLIBC_FLOOR_IMAGES,
  buildGlibcFloorDockerArgs,
  glibcFloorImage
} from './rebuild-native-at-glibc-floor.mjs'

const require = createRequire(import.meta.url)
const { isVersionNodeAboveFloor } = require('./verify-linux-glibc-floor.cjs')

describe('native modules built at the glibc floor', () => {
  it('builds in a digest-pinned manylinux image whose glibc is at or under the floor', () => {
    for (const image of Object.values(GLIBC_FLOOR_IMAGES)) {
      expect(image).toMatch(/@sha256:[0-9a-f]{64}$/)
      const [, major, minor] = image.match(/manylinux_(\d+)_(\d+)_/) ?? []
      expect(isVersionNodeAboveFloor(`GLIBC_${major}.${minor}`)).toBe(false)
    }
    expect(() => glibcFloorImage('ia32')).toThrow('No glibc-floor build image for ia32')
  })

  it('runs the forced Electron rebuild in the mounted checkout as the runner user', () => {
    const args = buildGlibcFloorDockerArgs({
      projectDir: '/work/orca',
      nodeDir: '/opt/hostedtoolcache/node/24.22.2/x64',
      arch: 'x64',
      uid: 1001,
      gid: 118
    })

    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--user', '1001:118'])
    expect(args).toContain('/work/orca:/work/orca')
    expect(args).toContain('/opt/hostedtoolcache/node/24.22.2/x64:/opt/orca-node:ro')
    expect(args).toContain(GLIBC_FLOOR_IMAGES.x64)
    expect(args.at(-1)).toContain('node config/scripts/rebuild-native-deps.mjs --force')
  })

  it('builds what ships and what the merge queue checks with the same container step', () => {
    const action = parse(
      readFileSync('.github/actions/build-native-at-glibc-floor/action.yml', 'utf8')
    )
    expect(action.runs.steps.map((step) => step.run).join('\n')).toContain(
      'node config/scripts/rebuild-native-at-glibc-floor.mjs'
    )

    const linuxBuilds = [
      ['.github/workflows/pr.yml', 'package', 'Package unpacked app'],
      ['.github/workflows/lab-release.yml', 'linux', 'Package and publish Linux artifacts']
    ]
    for (const [file, jobName, packageStepName] of linuxBuilds) {
      const job = parse(readFileSync(file, 'utf8')).jobs[jobName]
      const names = job.steps.map((step) => step.name)
      const build = job.steps.find(
        (step) => step.uses === './.github/actions/build-native-at-glibc-floor'
      )
      const packageStep = job.steps.find((step) => step.name === packageStepName)

      expect(job['runs-on'], jobName).toBe('ubuntu-26.04')
      expect(build, jobName).toBeDefined()
      expect(names.indexOf(build.name), jobName).toBeLessThan(names.indexOf(packageStepName))
      // Why: without it electron-builder's beforeBuild rebuilds on the runner image.
      expect(packageStep.env.ORCA_REUSE_PREPARED_NATIVE_RUNTIME, jobName).toBe('1')
      expect(packageStep.run, jobName).not.toContain('ensure-native-runtime')
    }
  })

  it('leaves release-cut alone only while it ships nothing from this fork', () => {
    const releaseCut = parse(readFileSync('.github/workflows/release-cut.yml', 'utf8'))

    // Why: if this fork starts cutting releases here, its linux-x64 and linux-arm64 builds need
    // the same container step (arm64 on GLIBC_FLOOR_IMAGES.arm64) before they ship.
    expect(releaseCut.jobs.cut.if).toBe("github.repository == 'stablyai/orca'")
    expect(releaseCut.jobs.build.needs).toContain('cut')
  })
})
