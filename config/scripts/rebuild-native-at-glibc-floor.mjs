#!/usr/bin/env node
// Why: a native module links the glibc of the machine that compiles it, so node-pty built on
// ubuntu-26.04 needed GLIBC_2.42 (ORCA-1285). manylinux_2_28 ships glibc 2.28 and gcc-toolset, so the
// build stays under the 2.31 floor that verify-linux-glibc-floor.cjs enforces on any runner image.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

import { runWithTransientRetry } from './transient-http-retry.mjs'

export const GLIBC_FLOOR_IMAGES = {
  x64: 'quay.io/pypa/manylinux_2_28_x86_64:2026.11.07-1@sha256:9555ba6c479fa69a2aa80ad1dc57154a60d562b19df159361d9379a02beb1e36',
  arm64:
    'quay.io/pypa/manylinux_2_28_aarch64:2026.11.07-1@sha256:cb37f0d66c8a75abb93cf6085cad1f1427cd7208f0c0fc48359bb1eea9924f21'
}
const CONTAINER_NODE_DIR = '/opt/orca-node'
// Why: node-gyp needs a current python3; the image keeps its CPython builds under /opt/python.
const CONTAINER_PYTHON = '/opt/python/cp312-cp312/bin/python3'

export function glibcFloorImage(arch) {
  const image = GLIBC_FLOOR_IMAGES[arch]
  if (!image) {
    throw new Error(`No glibc-floor build image for ${arch}`)
  }
  return image
}

export function buildGlibcFloorDockerArgs({ projectDir, nodeDir, arch, uid, gid }) {
  return [
    'run',
    '--rm',
    // Why: the build writes into the mounted checkout, which later host steps package.
    '--user',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp/orca-native-home',
    '-e',
    `PYTHON=${CONTAINER_PYTHON}`,
    '-v',
    `${projectDir}:${projectDir}`,
    // Why: setup-node's official Node build needs glibc 2.28, so the host's own Node runs inside.
    '-v',
    `${nodeDir}:${CONTAINER_NODE_DIR}:ro`,
    '-w',
    projectDir,
    glibcFloorImage(arch),
    'bash',
    '-c',
    `export PATH="${CONTAINER_NODE_DIR}/bin:$PATH" && node config/scripts/rebuild-native-deps.mjs --force`
  ]
}

function main() {
  if (process.platform !== 'linux') {
    console.error('[glibc-floor] rebuild-native-at-glibc-floor.mjs only builds Linux modules.')
    process.exit(2)
  }
  const image = glibcFloorImage(process.arch)
  const pull = runWithTransientRetry({
    run: () => spawnSync('docker', ['pull', image], { encoding: 'utf8' }),
    describe: 'docker pull'
  })
  if (!pull.ok) {
    process.stderr.write(pull.result.stderr ?? '')
    console.error(`[glibc-floor] docker pull ${image} failed`)
    process.exit(1)
  }
  const dockerArgs = buildGlibcFloorDockerArgs({
    projectDir: resolve(import.meta.dirname, '../..'),
    nodeDir: dirname(dirname(process.execPath)),
    arch: process.arch,
    uid: process.getuid(),
    gid: process.getgid()
  })
  const result = spawnSync('docker', dockerArgs, { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  process.exit(result.status ?? 1)
}

if (process.argv[1] === import.meta.filename) {
  main()
}
