import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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

afterEach(() => {
  try {
    proc?.kill('SIGKILL')
  } catch {
    // already gone
  }
  proc = null
  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = null
  }
})

async function waitFor(read: () => string, predicate: (output: string) => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate(read()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
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
    let output = ''
    proc.onData((chunk) => {
      output += chunk
    })
    const read = (): string => output

    await waitFor(read, (text) => text.includes(PROMPT))
    expect(output, 'shell never printed its prompt').toContain(PROMPT)
    const beforeJunk = output.length
    proc.write(SHIFT_ENTER_CSI_U)
    await waitFor(read, (text) => text.slice(beforeJunk).includes('2u'))
    expect(output.slice(beforeJunk), 'shell never echoed the CSI-u remainder').toContain('2u')

    // Why one write: the IPC hop and the line discipline can hand both chunks to the shell
    // in one read, the worst case of the race; separate writes only lose it sometimes.
    proc.write(buildPendingLineDiscardInputSequence(RESET_COMMAND).join(''))
    await waitFor(read, (text) => text.includes(RESET_OUTPUT))
    expect(output, JSON.stringify(output.slice(-300))).toContain(RESET_OUTPUT)
  })
})
