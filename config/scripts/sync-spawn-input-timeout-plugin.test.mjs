import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { runOxlintPluginOnSource } from './oxlint-plugin-test-runner.mjs'

const pluginPath = path.resolve('config/oxlint-plugins/sync-spawn-input-timeout.mjs')

function lintSource(source) {
  return runOxlintPluginOnSource({
    pluginName: 'sync-spawn-input-timeout',
    pluginPath,
    source,
    extension: 'ts',
    rules: {
      'sync-spawn-input-timeout/require-timeout': 'warn'
    }
  })
}

const violations = [
  ['spawnSync', "spawnSync('cat', [], { input: data })"],
  ['spawnSync without args', "spawnSync('cat', { input: data })"],
  ['execFileSync', "execFileSync('cat', ['-'], { input: data, encoding: 'utf8' })"],
  ['execSync', "execSync('cat', { input: data })"],
  ['member call', "childProcess.spawnSync('cat', [], { input: data })"],
  ['shorthand input', "const input = 'x'; spawnSync('cat', [], { input })"],
  ['string key', "spawnSync('cat', [], { 'input': data })"],
  ['zero timeout', "spawnSync('cat', [], { input: data, timeout: 0 })"],
  ['undefined timeout', "spawnSync('cat', [], { input: data, timeout: undefined })"],
  ['spread base', "spawnSync('cat', [], { ...base, input: data })"]
]

const accepted = [
  ['timeout', "spawnSync('cat', [], { input: data, timeout: 10_000 })"],
  ['computed timeout', "execFileSync('cat', [], { input: data, timeout: limitMs })"],
  ['no input', "spawnSync('cat', [], { encoding: 'utf8' })"],
  ['no options', "spawnSync('git', ['status'])"],
  ['async spawn', "spawn('cat', [], { input: data })"],
  ['other sync call', "readFileSync('a', { input: data })"]
]

describe('sync-spawn-input-timeout/require-timeout', () => {
  it.each(violations)('flags %s', (_name, source) => {
    const diagnostics = lintSource(source)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('timeout')
  })

  it.each(accepted)('accepts %s', (_name, source) => {
    expect(lintSource(source)).toEqual([])
  })
})

// Why: a spawnSync blocks the worker's event loop, so only its own timeout can end
// a child that never sees EOF on stdin; vitest's testTimeout cannot (ORCA-1123).
describe.skipIf(process.platform === 'win32')('a child stalled on stdin', () => {
  it('fails with ETIMEDOUT within its timeout instead of blocking the worker', () => {
    const startedAt = Date.now()
    const result = spawnSync(
      process.execPath,
      ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
      { input: Buffer.alloc(1_000_000, 'x'), timeout: 2_000 }
    )

    expect(result.error).toMatchObject({ code: 'ETIMEDOUT' })
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  })
})
