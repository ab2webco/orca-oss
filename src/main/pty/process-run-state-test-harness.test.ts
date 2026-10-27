import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { describeProcessForFailure, processRunState } from './process-run-state-test-harness'

const hasSh = process.platform !== 'win32' && spawnSync('/bin/sh', ['-c', 'true']).status === 0

describe.skipIf(!hasSh)('processRunState', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup()
    }
  })

  it('tells a running process, a zombie and a reaped pid apart', async () => {
    // Why: `exec sleep` replaces the shell that forked `sleep 0`, and sleep never reaps it.
    const holder = spawn('/bin/sh', ['-c', 'sleep 0 & echo $!; exec sleep 30'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    cleanups.push(() => holder.kill('SIGKILL'))
    const lines = createInterface({ input: holder.stdout })
    const zombiePid = Number((await lines[Symbol.asyncIterator]().next()).value)
    lines.close()
    expect(zombiePid).toBeGreaterThan(0)

    const deadline = Date.now() + 10_000
    while (processRunState(zombiePid) !== 'zombie' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(processRunState(zombiePid)).toBe('zombie')
    // The trap: signal 0 succeeds on a zombie, so it cannot tell "killed" from "running".
    expect(() => process.kill(zombiePid, 0)).not.toThrow()
    expect(processRunState(holder.pid ?? 0)).toBe('running')
    expect(describeProcessForFailure(zombiePid)).toContain(`parent ${holder.pid}`)

    holder.kill('SIGKILL')
    await new Promise((resolve) => holder.once('exit', resolve))
    expect(processRunState(holder.pid ?? 0)).toBe('gone')
  })
})
