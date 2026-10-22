// End to end against a fake `gh` on PATH: the retry script survives one 502 where
// the old inline `set -euo pipefail; gh api … > file` step did not (ORCA-659).
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, 'gh-api-with-retry.mjs')

// Answers each call with the next line of $FAKE_GH_PLAN: `502`, `404` or `200`.
function fakeGh(plan) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'))
  writeFileSync(join(dir, 'plan'), plan.join('\n'))
  writeFileSync(join(dir, 'calls'), '')
  const gh = join(dir, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
dir="$(dirname "$0")"
echo "$*" >> "$dir/calls"
n=$(wc -l < "$dir/calls" | tr -d ' ')
code=$(sed -n "\${n}p" "$dir/plan")
[ -n "$code" ] || code=$(tail -n 1 "$dir/plan")
case "$code" in
  200) echo '{"id":1}' ;;
  502) echo 'gh: Server Error (HTTP 502)' >&2; exit 1 ;;
  404) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
esac
`
  )
  chmodSync(gh, 0o755)
  const env = {
    ...process.env,
    PATH: `${dir}${delimiter}${process.env.PATH}`,
    ORCA_TRANSIENT_RETRY_BACKOFF_MS: '0,0,0'
  }
  const calls = () => readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean)
  return { dir, env, calls }
}

const runScript = (env, output) =>
  spawnSync(process.execPath, [script, '--output', output, '--', 'repos/o/r/actions/runs/1'], {
    env,
    encoding: 'utf8'
  })

describe.skipIf(process.platform === 'win32')('gh-api-with-retry', () => {
  it('exits 1 on a single 502 with the old inline step', () => {
    const { dir, env } = fakeGh(['502', '200'])
    const result = spawnSync(
      'bash',
      ['-c', `set -euo pipefail; gh api "repos/o/r/actions/runs/1" > "${dir}/ci-run.json"`],
      { env, encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
  })

  it('exits 0 on a 502 then 200 and writes the response', () => {
    const { dir, env, calls } = fakeGh(['502', '200'])
    const output = join(dir, 'ci-run.json')
    const result = runScript(env, output)
    expect(result.status, result.stderr).toBe(0)
    expect(calls()).toHaveLength(2)
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({ id: 1 })
  })

  it('exits non-zero after exactly one call on a 404', () => {
    const { dir, env, calls } = fakeGh(['404'])
    const result = runScript(env, join(dir, 'ci-run.json'))
    expect(result.status).not.toBe(0)
    expect(calls()).toHaveLength(1)
  })

  it('names the endpoint and final status and leaves no partial file on a sustained outage', () => {
    const { dir, env, calls } = fakeGh(['502'])
    const output = join(dir, 'ci-run.json')
    const result = runScript(env, output)
    expect(result.status).not.toBe(0)
    expect(calls()).toHaveLength(4)
    expect(result.stderr).toContain('repos/o/r/actions/runs/1')
    expect(result.stderr).toContain('HTTP 502')
    expect(existsSync(output)).toBe(false)
  })
})
