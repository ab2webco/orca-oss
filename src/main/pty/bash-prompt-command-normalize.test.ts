import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDaemonBashShellReadyRcfileContent } from '../daemon/daemon-bash-shell-ready-rcfile'
import { getDaemonBashShellReadyRcfileContent as getShellReadyDaemonBashRcfileContent } from '../daemon/shell-ready'
import { getBashShellReadyRcfileContent } from '../providers/local-pty-shell-ready-bash-rcfile'
import { getRelayShellLaunchConfig } from '../../relay/pty-shell-launch'

const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0

/**
 * Shaped like systemd's /etc/profile.d/80-systemd-osc-context.sh (systemd 258+, sourced by
 * /etc/profile on Ubuntu 26.04): PROMPT_COMMAND becomes an array and PS0 gains a hook.
 */
const SYSTEMD_OSC_CONTEXT_PROFILE = [
  "__ctx_precmdline() { printf '\\033]3008;start=shell\\033\\\\'; }",
  "__ctx_ps0() { printf '\\033]3008;start=command\\033\\\\'; }",
  `[ -n "$(declare -p PROMPT_COMMAND 2>/dev/null)" ] || PROMPT_COMMAND+=('')`,
  'PROMPT_COMMAND+=(__ctx_precmdline)',
  `PS0='$(__ctx_ps0)'"\${PS0:-}"`,
  "PS1='PROMPT> '",
  ''
].join('\n')

const oscA = '\x1b]133;A\x07'
const oscC = '\x1b]133;C\x07'
const oscD = '\x1b]133;D;'

const wrappers: [string, (home: string) => string][] = [
  ['local', () => getBashShellReadyRcfileContent()],
  ['daemon', () => getDaemonBashShellReadyRcfileContent()],
  // Why: shell-ready.ts writes the daemon's rcfile from its own copy, not the module above.
  ['daemon shell-ready', () => getShellReadyDaemonBashRcfileContent()],
  [
    'relay',
    (home) => readFileSync(getRelayShellLaunchConfig('/bin/bash', { HOME: home }).args[1], 'utf8')
  ]
]

function runWrapper(rcfileContent: string, home: string): string {
  const rcfile = join(home, 'bash-osc133-rcfile')
  writeFileSync(rcfile, rcfileContent)
  const result = spawnSync(
    'bash',
    ['-lc', 'bash --noprofile --rcfile "$1" -i 2>&1', 'bash', rcfile],
    {
      input: 'true\nfalse\nexit 0\n',
      encoding: 'utf8',
      env: { ...process.env, HOME: home, ORCA_SHELL_READY_MARKER: '1', TERM: 'xterm' },
      timeout: 5000
    }
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  return result.stdout
}

/** One C per command, each after its prompt was drawn, never while the shell sits idle. */
function expectOneCommandStartPerCommand(output: string): void {
  expect(output).toContain(`${oscD}0\x07${oscA}`)
  expect(output).toContain(`${oscD}1\x07${oscA}`)
  expect(output.split(oscC)).toHaveLength(4)
  expect(output.split(oscD)).toHaveLength(3)
  const [beforeFirstPrompt, ...prompts] = output.split(oscA)
  expect(beforeFirstPrompt).not.toContain(oscC)
  for (const prompt of prompts.filter((p) => p.includes(oscC))) {
    expect(prompt.slice(0, prompt.indexOf(oscC))).toContain('PROMPT> ')
  }
}

describe.runIf(hasBash)('bash wrappers with an array PROMPT_COMMAND from /etc/profile', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bash-prompt-command-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  // Why: a joined string assigned to the array replaced only [0], so systemd's hook stayed a
  // later element, ran after Orca closed the prompt window, and fired C at every idle prompt.
  it.each(wrappers)('%s: keeps the systemd hook inside the prompt window', (_, rcfile) => {
    writeFileSync(join(home, '.bash_profile'), SYSTEMD_OSC_CONTEXT_PROFILE)

    const output = runWrapper(rcfile(home), home)

    expect(output).toContain('\x1b]3008;start=shell')
    expectOneCommandStartPerCommand(output)
  })

  // Why: a legacy `PROMPT_COMMAND='...; '` assigns [0] of systemd's array; the join made ";;".
  it.each(wrappers)('%s: trims a separator-ended element before joining', (_, rcfile) => {
    writeFileSync(
      join(home, '.bash_profile'),
      `${SYSTEMD_OSC_CONTEXT_PROFILE}PROMPT_COMMAND='printf "PROMPT_SEP\\n"; '\n`
    )

    const output = runWrapper(rcfile(home), home)

    expect(output).not.toContain('syntax error')
    expect(output).toContain('PROMPT_SEP')
    expectOneCommandStartPerCommand(output)
  })
})
