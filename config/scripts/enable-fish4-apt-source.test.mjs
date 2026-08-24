import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A real Launchpad 500 cannot be provoked on demand, so the acquisition script is
// driven against a fake `sudo` on PATH. That is the part ORCA-287 changes: the
// retry, the backoff, and telling "source unavailable" apart from "fish 4 is here
// and the contract failed".

const SCRIPT = path.resolve(import.meta.dirname, 'enable-fish4-apt-source.sh')

/** A stub `sudo` that fails `add-apt-repository -y ppa:...` the first
 *  `failuresBeforeSuccess` times and records every call. */
async function fakeSudo(failuresBeforeSuccess) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orca-fish4-'))
  const callLog = path.join(dir, 'calls.log')
  const counter = path.join(dir, 'attempts')
  await fs.writeFile(counter, '0\n', 'utf8')
  await fs.writeFile(
    path.join(dir, 'sudo'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >>${JSON.stringify(callLog)}
# Only the add (not the -r removal) is the flaky call under test.
if [ "$1" = 'add-apt-repository' ] && [ "$2" = '-y' ] && [ "$3" != '-r' ]; then
  n=$(( $(cat ${JSON.stringify(counter)}) + 1 ))
  printf '%s\\n' "$n" >${JSON.stringify(counter)}
  if [ "$n" -le ${failuresBeforeSuccess} ]; then
    echo 'lazr.restfulclient.errors.ServerError: HTTP Error 500: Internal Server Error' >&2
    echo "b'GPGKeyTemporarilyNotFoundError'" >&2
    exit 1
  fi
fi
exit 0
`,
    { mode: 0o755 }
  )
  return { dir, callLog, counter }
}

function run(dir, statusFile) {
  try {
    // 2>&1 inside the shell: the script logs progress to stderr, and
    // execFileSync returns only stdout on success.
    const stderr = execFileSync('bash', ['-c', `bash ${JSON.stringify(SCRIPT)} 2>&1`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        ORCA_FISH4_SOURCE_STATUS_FILE: statusFile,
        // Zero-second backoff: the schedule's LENGTH is what matters here, not
        // the wall clock, and a test must not sleep through 155s.
        ORCA_FISH4_BACKOFF_SECONDS: '0 0 0 0'
      }
    })
    return { status: 0, output: stderr }
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

async function attemptsMade(counter) {
  return Number((await fs.readFile(counter, 'utf8')).trim())
}

describe('enable-fish4-apt-source', () => {
  it('retries a 500 and succeeds once the source comes back', async () => {
    const { dir, counter } = await fakeSudo(2)
    const statusFile = path.join(dir, 'status')
    const { status, output } = run(dir, statusFile)

    expect(status).toBe(0)
    expect(await attemptsMade(counter)).toBe(3)
    expect(output).toContain('attempt 1 failed')
    expect(output).toContain('attempt 2 failed')
    expect(await fs.readFile(statusFile, 'utf8')).toContain('ppa')
  })

  it('reports the source unavailable after exhausting the backoff', async () => {
    const { dir, counter } = await fakeSudo(Number.MAX_SAFE_INTEGER)
    const statusFile = path.join(dir, 'status')
    const { status } = run(dir, statusFile)

    // EX_TEMPFAIL, distinct from a contract failure.
    expect(status).toBe(75)
    // Four backoff entries plus the attempt after the last wait: the old inline
    // loop tried three times in 15s and all three landed in the same outage.
    expect(await attemptsMade(counter)).toBe(5)
    expect((await fs.readFile(statusFile, 'utf8')).trim()).toBe('unavailable')
  })

  it('drops the half-added PPA between attempts', async () => {
    const { dir, callLog } = await fakeSudo(1)
    const { status } = run(dir, path.join(dir, 'status'))

    expect(status).toBe(0)
    // A failed add leaves its list entry behind, and the next apt-get update then
    // exits non-zero for a reason unrelated to the PR.
    expect(await fs.readFile(callLog, 'utf8')).toContain('add-apt-repository -y -r')
  })

  it('does not retry a source that works on the first try', async () => {
    const { dir, counter } = await fakeSudo(0)
    const { status, output } = run(dir, path.join(dir, 'status'))

    expect(status).toBe(0)
    expect(await attemptsMade(counter)).toBe(1)
    expect(output).not.toContain('retrying')
  })
})

// The other half of ORCA-287: the version gate must SAY which failure it is.
// Extracted from pr.yml and run as a shell fragment, so the two branches are
// exercised rather than eyeballed in YAML.
describe('Require fish 4+ gate message', () => {
  const workflow = readFileSync(
    path.resolve(import.meta.dirname, '..', '..', '.github', 'workflows', 'pr.yml'),
    'utf8'
  )

  function gateScript() {
    const marker = '      - name: Require fish 4+\n        run: |\n'
    const start = workflow.indexOf(marker)
    expect(start, 'the Require fish 4+ step must exist').toBeGreaterThan(-1)
    const body = workflow.slice(start + marker.length)
    const lines = []
    for (const line of body.split('\n')) {
      if (line.trim() !== '' && !line.startsWith('          ')) {
        break
      }
      lines.push(line.slice(10))
    }
    return lines.join('\n')
  }

  function runGate({ fishVersion, sourceStatus }) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-fish4-gate-'))
    // A fake `fish` so the gate sees the version we are testing.
    writeFileSync(
      path.join(dir, 'fish'),
      fishVersion === null
        ? '#!/usr/bin/env bash\nexit 127\n'
        : `#!/usr/bin/env bash\necho 'fish, version ${fishVersion}'\n`,
      { mode: 0o755 }
    )
    if (sourceStatus !== null) {
      writeFileSync(path.join(dir, 'fish4-source-status'), `${sourceStatus}\n`, 'utf8')
    }
    try {
      const out = execFileSync('bash', ['-c', gateScript()], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir }
      })
      return { status: 0, output: out }
    } catch (error) {
      return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  }

  it('names the infrastructure when the apt source never came up', () => {
    const { status, output } = runGate({ fishVersion: '3.7.0', sourceStatus: 'unavailable' })
    expect(status).toBe(1)
    expect(output).toContain('INFRASTRUCTURE, not this PR')
    expect(output).toContain('ORCA-287')
    // The contract wording must NOT appear, or the reader is back to guessing.
    expect(output).not.toContain('DECSET 2031')
  })

  it('names the contract when the source was fine and fish is still old', () => {
    const { status, output } = runGate({ fishVersion: '3.7.0', sourceStatus: 'ppa' })
    expect(status).toBe(1)
    expect(output).toContain('DECSET 2031')
    expect(output).not.toContain('INFRASTRUCTURE')
  })

  it('still fails closed when the status file is missing entirely', () => {
    const { status, output } = runGate({ fishVersion: '3.7.0', sourceStatus: null })
    expect(status).toBe(1)
    expect(output).toContain('status=unknown')
  })

  it('passes on fish 4 without printing either diagnosis', () => {
    const { status, output } = runGate({ fishVersion: '4.0.2', sourceStatus: 'ppa' })
    expect(status).toBe(0)
    expect(output).not.toContain('::error::')
  })
})
