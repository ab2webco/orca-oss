import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, 'ci-apt.sh')

function runApt(
  result,
  args = ['install', '-y', 'build-essential', 'python3'],
  timeoutOverride = ''
) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-ci-apt-'))
  const makeCommand = (name, body) =>
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
  makeCommand('sudo', 'exec "$@"')
  makeCommand('timeout', 'echo "$*" >> "$CI_APT_TIMEOUT_LOG"; shift 3; exec "$@"')
  makeCommand('sleep', 'exit 0')
  makeCommand(
    'apt-get',
    `echo "$*" >> "$CI_APT_CALL_LOG"
case "$CI_APT_RESULT" in
  success) echo installed; exit 0 ;;
  fail-once) [ "$(wc -l < "$CI_APT_CALL_LOG")" -eq 1 ] && exit 100 || exit 0 ;;
  partial-uris) [ "$(wc -l < "$CI_APT_CALL_LOG")" -eq 1 ] && { echo stale.deb; exit 100; } || { echo current.deb; exit 0; } ;;
  timeout) exit 124 ;;
  fail) exit 100 ;;
esac`
  )
  const callLog = join(dir, 'calls')
  const timeoutLog = join(dir, 'timeouts')
  const output = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CI_APT_RESULT: result,
      CI_APT_CALL_LOG: callLog,
      CI_APT_TIMEOUT_LOG: timeoutLog,
      CI_APT_TIMEOUT: timeoutOverride
    }
  })
  const lines = (path) => {
    try {
      return readFileSync(path, 'utf8').trim().split('\n')
    } catch {
      return []
    }
  }
  return { ...output, calls: lines(callLog), timeouts: lines(timeoutLog) }
}

describe('bounded CI apt', () => {
  it('preserves arguments while applying acquire and hard timeouts', () => {
    const result = runApt('success', ['install', '--print-uris', '-y', 'zsh', 'fish'])
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([
      '-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install --print-uris -y zsh fish'
    ])
    expect(result.timeouts).toEqual([
      '--signal=TERM --kill-after=10s 120s apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install --print-uris -y zsh fish'
    ])
  })

  it('uses the short deadline for update', () => {
    const result = runApt('success', ['update'])
    expect(result.timeouts[0]).toContain('--kill-after=10s 120s apt-get')
  })

  it('allows enough time for a real package install', () => {
    const result = runApt('success', ['install', '-y', 'fonts-noto-cjk'])
    expect(result.timeouts[0]).toContain('--kill-after=10s 600s apt-get')
  })

  it('accepts an explicit deadline override', () => {
    const result = runApt('success', ['install', '-y', 'zsh'], '75s')
    expect(result.timeouts[0]).toContain('--kill-after=10s 75s apt-get')
  })

  it('retries a failed attempt once and succeeds', () => {
    const result = runApt('fail-once', ['update'])
    expect(result.status).toBe(0)
    expect(result.calls).toHaveLength(2)
  })

  it('preserves stdout for ordinary installs', () => {
    const result = runApt('success', ['install', '-y', 'zsh'])
    expect(result.stdout).toBe('installed\n')
  })

  it('discards partial print-uris output from a failed attempt', () => {
    const result = runApt('partial-uris', ['install', '--print-uris', '-qq', '-y', 'zsh'])
    expect(result.status).toBe(0)
    expect(result.calls).toHaveLength(2)
    expect(result.stdout).toBe('current.deb\n')
  })

  it('reports exhaustion after a hard timeout instead of hanging', () => {
    const result = runApt('timeout', ['update'])
    expect(result.status).toBe(124)
    expect(result.calls).toHaveLength(2)
    expect(result.stderr).toContain('apt-get update failed after 2 attempts (exit 124)')
  })

  it('preserves a non-timeout failure exit code', () => {
    const result = runApt('fail', ['install', '-y', 'zsh'])
    expect(result.status).toBe(100)
    expect(result.calls).toHaveLength(2)
  })
})
