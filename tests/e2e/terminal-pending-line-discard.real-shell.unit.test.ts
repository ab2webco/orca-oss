import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IPty } from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPendingLineDiscardInputSequence } from './terminal-probe-input-sequence'

/**
 * ORCA-881: terminal-shortcuts leaves Shift+Enter's CSI-u at the prompt, clears it, then
 * resets the Kitty flags with a printf. Only the printf's own output proves it ran: the
 * echo of the typed command carries a literal backslash, never the ESC byte.
 */

const PROMPT = 'ORCA881> '
const SHIFT_ENTER_CSI_U = '\x1b[13;2u'
const RESET_COMMAND = "printf '\\033[=0u'\r"
const RESET_OUTPUT = '\x1b[=0u'

const SHELLS = [
  { name: 'bash', args: ['--norc', '--noprofile', '-i'] },
  { name: 'zsh', args: ['-f', '-i'] }
].filter(({ name }) => process.platform !== 'win32' && spawnSync(name, ['--version']).status === 0)

let proc: IPty | null = null
let home: string | null = null
let exited: { exitCode: number; signal?: number } | null = null
let spawnedAt = 0

afterEach(() => {
  try {
    proc?.kill('SIGKILL')
  } catch {
    // already gone
  }
  proc = null
  exited = null
  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = null
  }
})

// Why no larger budget (ORCA-1246): bash prompts in 5-11 ms idle and 11-43 ms on 4x oversubscribed
// CPUs, so 5 s of silence is a spawn or reader fault, and the diagnosis below names which.
async function waitFor(read: () => string, predicate: (output: string) => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate(read()) && !exited && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  // Why: a stall past the deadline resumes in the timers phase, before the pty's pending reads.
  await new Promise((resolve) => setImmediate(resolve))
}

function procState(pid: number): string {
  if (process.platform !== 'linux') {
    return 'n/a'
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const wchan = readFileSync(`/proc/${pid}/wchan`, 'utf8')
    return `${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]} wchan=${wchan || '0'}`
  } catch {
    return 'gone'
  }
}

function describePty(pty: IPty, output: string, what: string): string {
  let alive = false
  try {
    process.kill(pty.pid, 0)
    alive = true
  } catch {
    // not running
  }
  return `${what}: ${JSON.stringify({
    pid: pty.pid,
    alive,
    state: procState(pty.pid),
    exit: exited,
    bytes: output.length,
    elapsedMs: Date.now() - spawnedAt,
    tail: output.slice(-300)
  })}`
}

describe.skipIf(SHELLS.length === 0)('pending line discard against a real shell', () => {
  it.each(SHELLS)('$name runs the command written right after the discard', async (shell) => {
    const pty = await import('node-pty')
    home = mkdtempSync(join(tmpdir(), 'orca-881-'))
    proc = pty.spawn(shell.name, shell.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 24,
      cwd: home,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: home,
        TERM: 'xterm-256color',
        LANG: 'C',
        PS1: PROMPT
      }
    })
    spawnedAt = Date.now()
    const spawned = proc
    // Why the check: the previous shell's SIGKILL exit can land after this test starts, and it
    // would end every wait at once (ORCA-1407).
    proc.onExit((event) => {
      if (proc === spawned) {
        exited = event
      }
    })
    let output = ''
    proc.onData((chunk) => {
      output += chunk
    })
    const read = (): string => output

    await waitFor(read, (text) => text.includes(PROMPT))
    expect(output, describePty(proc, output, 'shell never printed its prompt')).toContain(PROMPT)
    const beforeJunk = output.length
    proc.write(SHIFT_ENTER_CSI_U)
    await waitFor(read, (text) => text.slice(beforeJunk).includes('2u'))
    expect(
      output.slice(beforeJunk),
      describePty(proc, output, 'shell never echoed the CSI-u remainder')
    ).toContain('2u')

    // Why one write: the IPC hop and the line discipline can hand both chunks to the shell
    // in one read, the worst case of the race; separate writes only lose it sometimes.
    proc.write(buildPendingLineDiscardInputSequence(RESET_COMMAND).join(''))
    await waitFor(read, (text) => text.includes(RESET_OUTPUT))
    expect(output, describePty(proc, output, 'reset never ran')).toContain(RESET_OUTPUT)
  })
})
