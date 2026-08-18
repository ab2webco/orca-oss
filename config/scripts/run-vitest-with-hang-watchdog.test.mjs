import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const WATCHDOG = resolve('config/scripts/run-vitest-with-hang-watchdog.mjs')
let fixtureDir = ''

/** Stands in for vitest: journals what it is told to, then behaves as `mode` says. */
function writeFakeVitest(name, body) {
  const path = join(fixtureDir, name)
  writeFileSync(
    path,
    `import { appendFileSync, writeFileSync } from 'node:fs'
const journal = process.env.ORCA_VITEST_HANG_JOURNAL
const record = (event) => appendFileSync(journal, JSON.stringify(event) + '\\n')
writeFileSync(${JSON.stringify(join(fixtureDir, `${name}.argv.json`))}, JSON.stringify(process.argv.slice(2)))
${body}
`
  )
  return path
}

function runWatchdog(fakeVitest, args, idleSeconds) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [WATCHDOG, ...args], {
      env: {
        ...process.env,
        ORCA_VITEST_BIN: fakeVitest,
        ORCA_VITEST_HANG_IDLE_SECONDS: String(idleSeconds)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('exit', (code) => done({ code, stdout, stderr }))
  })
}

describe('run-vitest-with-hang-watchdog', () => {
  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'orca-hang-watchdog-test-'))
  })
  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('names the module that never finished and exits 124', async () => {
    const fake = writeFakeVitest(
      'silent.mjs',
      `record({ event: 'run-start', atMs: Date.now(), modules: ['fast.test.ts', 'wedged.test.ts'] })
record({ event: 'module-queued', atMs: Date.now(), module: 'fast.test.ts' })
record({ event: 'module-end', atMs: Date.now(), module: 'fast.test.ts' })
record({ event: 'module-queued', atMs: Date.now(), module: 'wedged.test.ts' })
console.log('one line, then silence')
setTimeout(() => {}, 120_000)`
    )
    const result = await runWatchdog(fake, ['--shard=9/16'], 2)
    expect(result.stderr).toContain('wedged.test.ts')
    expect(result.stderr).toContain('verdict: wedged-modules')
    expect(result.stderr).toContain('1 finished of 2 planned')
    expect(result.stderr).toContain('surviving process tree:')
    expect(result.code).toBe(124)
  })

  it('calls a run that ended but would not exit a teardown hang, not a red test', async () => {
    const fake = writeFakeVitest(
      'teardown.mjs',
      `record({ event: 'run-start', atMs: Date.now(), modules: ['fast.test.ts'] })
record({ event: 'module-queued', atMs: Date.now(), module: 'fast.test.ts' })
record({ event: 'module-end', atMs: Date.now(), module: 'fast.test.ts' })
record({ event: 'run-end', atMs: Date.now(), reason: 'passed' })
console.log('done')
setTimeout(() => {}, 120_000)`
    )
    const result = await runWatchdog(fake, [], 2)
    expect(result.stderr).toContain('verdict: teardown-hang')
    expect(result.stderr).toContain('every module finished')
    expect(result.code).toBe(124)
  })

  it('forwards its arguments untouched and adds only reporters', async () => {
    const fake = writeFakeVitest('argv.mjs', `process.exit(0)`)
    const args = ['--config', 'config/vitest.config.ts', '--exclude=a/b.test.ts', '--shard=9/16']
    const result = await runWatchdog(fake, args, 30)
    expect(result.code).toBe(0)
    const forwarded = JSON.parse(readFileSync(`${fake}.argv.json`, 'utf8'))
    expect(forwarded.slice(0, 1 + args.length)).toEqual(['run', ...args])
    expect(forwarded.slice(1 + args.length).every((flag) => flag.startsWith('--reporter='))).toBe(
      true
    )
  })

  it('passes a healthy run through with its own exit code and no hang marker', async () => {
    const fake = writeFakeVitest(
      'failing.mjs',
      `console.log('ran'); console.error('1 test failed'); process.exit(3)`
    )
    const result = await runWatchdog(fake, [], 30)
    expect(result.code).toBe(3)
    expect(result.stdout).toContain('ran')
    expect(result.stderr).not.toContain('orca hang watchdog')
  })

  it('rejects a non-positive idle ceiling instead of watching forever', async () => {
    const fake = writeFakeVitest('unused.mjs', `process.exit(0)`)
    const result = await runWatchdog(fake, [], 0)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('ORCA_VITEST_HANG_IDLE_SECONDS')
  })
})
