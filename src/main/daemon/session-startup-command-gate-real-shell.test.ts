import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, type SubprocessHandle } from './session'
import { getZshShellReadyMarkerRegistrationBlock } from '../shell-templates'

/**
 * The gate against a real zsh (ORCA-210).
 *
 * The unit tests next door drive the state machine with a fake subprocess; this
 * one proves the premise they rest on — a shell holding the tty on a
 * startup-file question emits no shell-ready marker, and emits one as soon as
 * the question is answered. oh-my-zsh's update prompt is reproduced with the
 * primitive it actually uses (`read -r -k 1` from inside .zshrc), because that
 * is what turns the launch command's first character into the answer.
 */

const hasZsh = process.platform !== 'win32' && spawnSync('zsh', ['--version']).status === 0
const describeWithZsh = hasZsh ? describe : describe.skip

const QUESTION = '[repro] Would you like to update? [Y/n] '
const MARKER_PRINTF_ESCAPED = '\\033]777;orca-shell-ready\\007'
const LAUNCH = "printf 'ORCA210_LAUNCHED\\n'\n"

type RealZshSubprocess = SubprocessHandle & {
  /** Everything the PTY emitted, marker bytes included. */
  readonly output: string
  destroy: () => void
}

async function spawnRealZsh(zdotdir: string): Promise<RealZshSubprocess> {
  const pty = await import('node-pty')
  // Why -o noglobalrcs: /etc/zsh/* can make compinit block on its own [y/n]
  // prompt, which would confound the one this test arms deliberately.
  const proc = pty.spawn('zsh', ['-o', 'noglobalrcs', '-i'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: zdotdir,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: zdotdir,
      TERM: 'xterm-256color',
      ZDOTDIR: zdotdir,
      ORCA_SHELL_READY_MARKER: '1'
    }
  })
  let output = ''
  proc.onData((chunk) => {
    output += chunk
  })
  return {
    pid: proc.pid,
    get output() {
      return output
    },
    getForegroundProcess: () => proc.process ?? null,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    forceKill: () => proc.kill('SIGKILL'),
    signal: (sig) => proc.kill(sig),
    onData: (cb) => {
      proc.onData(cb)
    },
    onExit: (cb) => {
      proc.onExit(({ exitCode }) => cb(exitCode))
    },
    dispose: () => proc.kill(),
    destroy: () => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

function writeZshrc(zdotdir: string, lines: string[]): void {
  writeFileSync(
    join(zdotdir, '.zshrc'),
    [
      'PS1="-> %% "',
      ...lines,
      getZshShellReadyMarkerRegistrationBlock(MARKER_PRINTF_ESCAPED),
      ''
    ].join('\n')
  )
}

describeWithZsh('Session startup command gate against a real zsh (ORCA-210)', () => {
  let cleanup: (() => void)[] = []

  afterEach(() => {
    for (const fn of cleanup.toReversed()) {
      fn()
    }
    cleanup = []
  })

  it('withholds the launch command while a startup question owns the tty, then delivers it intact', async () => {
    const zdotdir = mkdtempSync(join(tmpdir(), 'orca210-'))
    cleanup.push(() => rmSync(zdotdir, { recursive: true, force: true }))
    writeZshrc(zdotdir, [
      // The oh-my-zsh update question, reduced to the primitive that causes the
      // bug: one key read from inside the rc, before any prompt exists.
      `printf '%s' ${JSON.stringify(QUESTION)}`,
      'read -r -k 1 _orca210_answer',
      'echo',
      'echo "[repro] the question consumed: ${_orca210_answer}"'
    ])

    const subprocess = await spawnRealZsh(zdotdir)
    cleanup.push(() => subprocess.destroy())
    const states: string[] = []
    const session = new Session({
      sessionId: 'orca210-real-shell',
      cols: 80,
      rows: 24,
      subprocess,
      shellReadySupported: true,
      startupCommandRequiresShellReady: true,
      shellReadyTimeoutMs: 1000,
      onStartupCommandStateChange: (state) => states.push(state)
    })
    cleanup.push(() => session.dispose())

    session.writeStartupCommand(LAUNCH)

    expect(await waitFor(() => subprocess.output.includes('[Y/n]'), 10_000)).toBe(true)

    // Past the budget: the question still owns the tty, so nothing was written
    // and the fact left the session on its own.
    expect(await waitFor(() => states.includes('withheld'), 5_000)).toBe(true)
    expect(states).toEqual(['withheld'])
    expect(session.shellState).toBe('timed_out')
    expect(subprocess.output).not.toContain('ORCA210_LAUNCHED')
    // The pre-fix failure as an assertion: writing here would have fed `p` to
    // the question and left the shell running `rintf`.
    expect(subprocess.output).not.toContain('rintf')

    // The human answers; zsh finishes its rc, reaches a prompt, and
    // zle-line-init fires the marker.
    session.write('n')

    expect(await waitFor(() => subprocess.output.includes('ORCA210_LAUNCHED'), 15_000)).toBe(true)
    expect(states).toEqual(['withheld', 'delivered'])
    expect(session.startupCommandState).toBe('delivered')
    expect(subprocess.output).toContain('[repro] the question consumed: n')
    expect(subprocess.output).not.toContain('command not found')
  }, 40_000)

  it('delivers without reporting anything when nothing holds the tty', async () => {
    const zdotdir = mkdtempSync(join(tmpdir(), 'orca210-'))
    cleanup.push(() => rmSync(zdotdir, { recursive: true, force: true }))
    writeZshrc(zdotdir, [])

    const subprocess = await spawnRealZsh(zdotdir)
    cleanup.push(() => subprocess.destroy())
    const states: string[] = []
    const session = new Session({
      sessionId: 'orca210-real-shell-clean',
      cols: 80,
      rows: 24,
      subprocess,
      shellReadySupported: true,
      startupCommandRequiresShellReady: true,
      shellReadyTimeoutMs: 5000,
      onStartupCommandStateChange: (state) => states.push(state)
    })
    cleanup.push(() => session.dispose())

    session.writeStartupCommand(LAUNCH)

    expect(await waitFor(() => subprocess.output.includes('ORCA210_LAUNCHED'), 15_000)).toBe(true)
    // Nothing to report: the marker beat the budget, which is the ordinary path.
    expect(states).toEqual([])
  }, 40_000)
})
