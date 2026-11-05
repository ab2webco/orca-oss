import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

// Fake apt-get: FAKE_SNAPSHOT=ok serves everything; =404 fails every install that has no
// pinned live mirror beside the snapshot, the way CI saw libwrap0 fail; FAKE_UPDATE_FAILS=N
// fails the first N updates. Each call logs its args and which sources apt would read.
const FAKE_APT_GET = `#!/bin/sh
etc="$APT_ETC"
mirror=no
[ -f "$etc/sources.list.d/live-mirror.sources" ] && grep -qx 'Pin-Priority: 1' "$etc/preferences.d/live-mirror" && mirror=yes
snapshot=no
grep -q 'URIs: https://snapshot.debian.org/archive/debian/20260713T000000Z' "$etc/sources.list.d/debian.sources" && snapshot=yes
case "$*" in
  *" update")
    count=$(cat "$FAKE_STATE/updates" 2>/dev/null || echo 0)
    echo $((count + 1)) > "$FAKE_STATE/updates"
    echo "update snapshot=$snapshot mirror=$mirror" >> "$FAKE_STATE/log"
    [ "$count" -lt "\${FAKE_UPDATE_FAILS:-0}" ] && { echo "E: Failed to fetch InRelease  404  NOT FOUND" >&2; exit 100; }
    exit 0 ;;
  install*)
    echo "install snapshot=$snapshot mirror=$mirror" >> "$FAKE_STATE/log"
    echo "$*" > "$FAKE_STATE/install-args"
    [ "$FAKE_SNAPSHOT" = ok ] && exit 0
    [ "$FAKE_SNAPSHOT" = 404 ] && [ "$mirror" = yes ] && exit 0
    echo "E: Failed to fetch https://snapshot.debian.org/archive/debian/20260713T000000Z/pool/main/t/tcp-wrappers/libwrap0_7.6.q-32_amd64.deb  404  NOT FOUND [IP: 146.75.106.132 443]" >&2
    exit 100 ;;
esac
exit 2
`

const PINNED_INSTALL =
  'install -y --no-install-recommends git=1:2.39.5-0+deb12u3 openssh-server=1:9.2p1-2+deb12u10'

const roots: string[] = []

function runInstall(env: Record<string, string>): {
  status: number | null
  stderr: string
  log: string[]
  installArgs: string
  etc: string
} {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orca-ssh-relay-install-'))
  roots.push(root)
  const etc = path.join(root, 'etc-apt')
  const bin = path.join(root, 'bin')
  const state = path.join(root, 'state')
  for (const dir of [
    path.join(etc, 'sources.list.d'),
    path.join(etc, 'preferences.d'),
    bin,
    state
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path.join(etc, 'sources.list.d', 'debian.sources'), BASE_SOURCES)
  writeFileSync(path.join(bin, 'apt-get'), FAKE_APT_GET)
  chmodSync(path.join(bin, 'apt-get'), 0o755)
  const result = spawnSync('sh', [SCRIPT], {
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      APT_ETC: etc,
      FAKE_STATE: state,
      ...env
    },
    encoding: 'utf8'
  })
  const logFile = path.join(state, 'log')
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n') : []
  const argsFile = path.join(state, 'install-args')
  const installArgs = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim() : ''
  return { status: result.status, stderr: result.stderr, log, installArgs, etc }
}

function expectCleanEtc(etc: string): void {
  expect(existsSync(path.join(etc, 'live-mirror.sources'))).toBe(false)
  expect(existsSync(path.join(etc, 'sources.list.d', 'live-mirror.sources'))).toBe(false)
  expect(existsSync(path.join(etc, 'preferences.d', 'live-mirror'))).toBe(false)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('docker-ssh-relay install-pinned-packages.sh', () => {
  it('installs from the snapshot alone when it answers', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'ok' })

    expect(run.status).toBe(0)
    expect(run.log).toEqual(['update snapshot=yes mirror=no', 'install snapshot=yes mirror=no'])
    expect(run.installArgs).toBe(PINNED_INSTALL)
    expect(readFileSync(path.join(run.etc, 'sources.list.d', 'debian.sources'), 'utf8')).toContain(
      'URIs: https://snapshot.debian.org/archive/debian-security/20260713T000000Z'
    )
    expectCleanEtc(run.etc)
  })

  it('survives a snapshot 404 by adding the pinned live mirror beside the snapshot', () => {
    const run = runInstall({ FAKE_SNAPSHOT: '404' })

    expect(run.status).toBe(0)
    expect(run.log).toEqual([
      'update snapshot=yes mirror=no',
      'install snapshot=yes mirror=no',
      'update snapshot=yes mirror=yes',
      'install snapshot=yes mirror=yes'
    ])
    expect(run.installArgs).toBe(PINNED_INSTALL)
    expectCleanEtc(run.etc)
  })

  it('survives one failed snapshot index fetch', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'ok', FAKE_UPDATE_FAILS: '1' })

    expect(run.status).toBe(0)
    expect(run.log).toEqual([
      'update snapshot=yes mirror=no',
      'update snapshot=yes mirror=yes',
      'install snapshot=yes mirror=yes'
    ])
  })

  it('still fails when the mirror cannot serve the pinned versions either', () => {
    const run = runInstall({ FAKE_SNAPSHOT: 'down' })

    expect(run.status).not.toBe(0)
    expect(run.log).toHaveLength(4)
    expect(run.stderr).toContain('404  NOT FOUND')
  })
})
