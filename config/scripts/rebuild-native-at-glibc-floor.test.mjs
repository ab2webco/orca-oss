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

  it('packages on ubuntu-26.04 from modules the container built', () => {
    const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
    const job = workflow.jobs.package
    const names = job.steps.map((step) => step.name)
    const build = job.steps.find((step) => step.name === 'Build native modules at the glibc floor')

    expect(job['runs-on']).toBe('ubuntu-26.04')
    expect(build?.run).toContain('node config/scripts/rebuild-native-at-glibc-floor.mjs')
    expect(names.indexOf('Build native modules at the glibc floor')).toBeLessThan(
      names.indexOf('Package unpacked app')
    )
  })
})
