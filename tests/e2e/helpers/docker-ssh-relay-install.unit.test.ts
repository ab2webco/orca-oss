import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'docker-ssh-relay',
  'install-pinned-packages.sh'
)

// The node:22-bookworm base image's own sources file.
const BASE_SOURCES = `Types: deb
URIs: http://deb.debian.org/debian
Suites: bookworm bookworm-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: http://deb.debian.org/debian-security
Suites: bookworm-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
`

const SNAPSHOT_URI = 'URIs: https://snapshot.debian.org/archive/debian/20260713T000000Z'

const PINNED_INSTALL =
  'install --no-download -y --no-install-recommends git=1:2.39.5-0+deb12u3 openssh-server=1:9.2p1-2+deb12u10 openssh-sftp-server=1:9.2p1-2+deb12u10 libwrap0=7.6.q-32 runit-helper=2.15.2'

// Fake apt-get. The configured source (snapshot or mirror) answers per FAKE_SNAPSHOT/FAKE_MIRROR:
// ok, 404 (a .deb is missing, as CI saw libwrap0), stall (a .deb download never ends, as CI saw on
// job 127553407551), index-stall (update never ends) or down (update warns and gets no lists, the
// way apt exits 0 on fetch errors). A stall execs sleep so a kill ends it; its pid is kept for cleanup.
const FAKE_APT_GET = `#!/bin/sh
state="$FAKE_STATE"
if grep -q 'snapshot.debian.org' "$APT_ETC/sources.list.d/debian.sources"; then
  source=snapshot; mode="$FAKE_SNAPSHOT"
else
  source=mirror; mode="$FAKE_MIRROR"
fi
case " $* " in
  *" update "*) step=update ;;
  *" --no-download "*) step=install; echo "$*" > "$state/install-args" ;;
  *" install "*) step=download ;;
  *) step=other ;;
esac
echo "$step $source" >> "$state/log"
stall() { echo $$ >> "$state/stalled-pids"; exec sleep 600; }
case "$step" in
  update)
    rm -f "$state/lists"
    [ "$mode" = index-stall ] && stall
    [ "$mode" = down ] && { echo "W: Failed to fetch $source InRelease  Connection timed out" >&2; exit 0; }
    echo "$source" > "$state/lists"; exit 0 ;;
  download)
    [ "$(cat "$state/lists" 2>/dev/null)" = "$source" ] || { echo "E: Version '1:2.39.5-0+deb12u3' for 'git' was not found" >&2; exit 100; }
    [ "$mode" = stall ] && stall
    [ "$mode" = 404 ] && { echo "E: Failed to fetch https://snapshot.debian.org/archive/debian/20260713T000000Z/pool/main/t/tcp-wrappers/libwrap0_7.6.q-32_amd64.deb  404  NOT FOUND" >&2; exit 100; }
    echo "$source" > "$state/archives"; exit 0 ;;
  install)
    [ -f "$state/archives" ] || { echo "E: Unable to fetch some archives" >&2; exit 100; }
    exit 0 ;;
esac
exit 2
`

type InstallRun = {
  status: number | null
  output: string
  log: string[]
  installArgs: string
  etc: string
  elapsedMs: number
}

const roots: string[] = []

function readIfPresent(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
}

function runInstall(env: Record<string, string>): InstallRun {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orca-ssh-relay-install-'))
  roots.push(root)
  const etc = path.join(root, 'etc-apt')
  const bin = path.join(root, 'bin')
  const state = path.join(root, 'state')
  for (const dir of [path.join(etc, 'sources.list.d'), bin, state]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path.join(etc, 'sources.list.d', 'debian.sources'), BASE_SOURCES)
  writeFileSync(path.join(bin, 'apt-get'), FAKE_APT_GET)
  chmodSync(path.join(bin, 'apt-get'), 0o755)
  // Why a file and not a pipe: a stalled fake left behind must not hold spawnSync open.
  const outputFile = path.join(root, 'output.txt')
  const outputFd = openSync(outputFile, 'w')
  const started = Date.now()
  const result = spawnSync('sh', [SCRIPT], {
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      APT_ETC: etc,
      APT_STEP_SECONDS: '1',
      FAKE_STATE: state,
      FAKE_MIRROR: 'ok',
      ...env
    },
    stdio: ['ignore', outputFd, outputFd],
    timeout: 15_000
  })
  const elapsedMs = Date.now() - started
  closeSync(outputFd)
  const log = readIfPresent(path.join(state, 'log'))
  return {
    status: result.status,
    output: readIfPresent(outputFile),
    log: log ? log.split('\n') : [],
    installArgs: readIfPresent(path.join(state, 'install-args')),
    etc,
    elapsedMs
  }
}

function expectFinalState(run: InstallRun): void {
  expect(run.status).toBe(0)
  expect(run.installArgs).toBe(PINNED_INSTALL)
  expect(readFileSync(path.join(run.etc, 'sources.list.d', 'debian.sources'), 'utf8')).toContain(
    SNAPSHOT_URI
  )
  expect(existsSync(path.join(run.etc, 'live-mirror.sources'))).toBe(false)
  expect(existsSync(path.join(run.etc, 'snapshot.sources'))).toBe(false)
}

const FALLBACK_LOG = ['update mirror', 'download mirror', 'install mirror']

afterEach(() => {
  for (const root of roots.splice(0)) {
    // Why the filter: Number('') is 0, and process.kill(0) signals this whole process group.
    const pids = readIfPresent(path.join(root, 'state', 'stalled-pids'))
      .split('\n')
      .map(Number)
      .filter((pid) => pid > 0)
    for (const pid of pids) {
      try {
        process.kill(pid)
      } catch {
        // Already ended.
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('docker-ssh-relay install-pinned-packages.sh', () => {
  it('installs from the snapshot alone when it answers', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'ok' })

    expect(run.log).toEqual(['update snapshot', 'download snapshot', 'install snapshot'])
    expectFinalState(run)
  })

  it('fetches the same pins from the mirror when the snapshot 404s a package', () => {
    const run = runInstall({ FAKE_SNAPSHOT: '404' })

    expect(run.log).toEqual(['update snapshot', 'download snapshot', ...FALLBACK_LOG])
    expectFinalState(run)
  })

  it('caps a stalled snapshot download and falls back within the step budget', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'stall' })

    expect(run.log).toEqual(['update snapshot', 'download snapshot', ...FALLBACK_LOG])
    expectFinalState(run)
    expect(run.elapsedMs).toBeLessThan(10_000)
  })

  it('falls back when the snapshot index itself stalls', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'index-stall' })

    expect(run.log).toEqual(['update snapshot', ...FALLBACK_LOG])
    expectFinalState(run)
    expect(run.elapsedMs).toBeLessThan(10_000)
  })

  it('fails, inside its budget, when neither source can serve the pins', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'stall', FAKE_MIRROR: 'down' })

    expect(run.status).not.toBe(0)
    expect(run.status).not.toBeNull()
    expect(run.log).toEqual([
      'update snapshot',
      'download snapshot',
      'update mirror',
      'download mirror'
    ])
    expect(run.output).toContain("for 'git' was not found")
    expect(run.elapsedMs).toBeLessThan(10_000)
  })
})
