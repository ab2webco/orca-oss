import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const hooksDir = resolve(import.meta.dirname, '../../.claude/hooks')
const resolver = join(hooksDir, 'orca_cli.py')
const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
  encoding: 'utf8'
}).trim()
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-cli-resolver-')))
  tempDirs.push(dir)
  return dir
}

function stub(dir, name, body = 'exit 0') {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return path
}

/** A bin dir whose `orca` plays the screen reader: it only logs that something started it. */
function fakeReader() {
  const bin = tempDir()
  const log = join(bin, 'reader-started')
  stub(bin, 'orca', `echo "$*" >> '${log}'`)
  return { bin, log, started: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') }
}

function resolveCli(env) {
  const { status, stdout } = spawnSync(python, [resolver], { encoding: 'utf8', env })
  return { status, path: stdout.trim() }
}

/** The resolver as another OS would run it; `resolve_orca_cli` takes the platform as an argument. */
function resolveOn(platform, env) {
  const code = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(hooksDir)})`,
    'from orca_cli import resolve_orca_cli',
    `print(resolve_orca_cli(json.loads(${JSON.stringify(JSON.stringify(env))}), ${JSON.stringify(platform)}))`
  ].join('\n')
  return execFileSync(python, ['-c', code], { encoding: 'utf8' }).trim()
}

describe('orca_cli resolver', () => {
  it('prefers the explicit command, then the one Orca set, then orca-ide', () => {
    const bin = tempDir()
    const ide = stub(bin, 'orca-ide')
    const PATH = bin
    expect(resolveCli({ PATH, ORCA_CLI_COMMAND: '/a', ORCA_GAME_CLI: '/b' }).path).toBe('/a')
    expect(resolveCli({ PATH, ORCA_GAME_CLI: '/b' }).path).toBe('/b')
    expect(resolveCli({ PATH }).path).toBe(ide)
  })

  it('finds nothing on an empty PATH and exits 1', () => {
    expect(resolveCli({ PATH: tempDir() })).toEqual({ status: 1, path: '' })
  })

  it.each(['linux', 'freebsd14'])('refuses a bare orca on %s', (platform) => {
    const { bin, started } = fakeReader()
    expect(resolveOn(platform, { PATH: bin })).toBe('None')
    expect(started()).toBe('')
  })

  it.each(['darwin', 'win32'])('accepts a bare orca on %s, where Orca installs it', (platform) => {
    const { bin } = fakeReader()
    expect(resolveOn(platform, { PATH: bin })).toBe(join(bin, 'orca'))
  })

  it('accepts the shim Orca puts first on PATH in its Linux terminals', () => {
    const shimDir = join(tempDir(), 'linux-orca-cli-shim')
    mkdirSync(shimDir)
    const shim = stub(shimDir, 'orca')
    const { bin } = fakeReader()
    expect(resolveOn('linux', { PATH: `${bin}:${shimDir}` })).toBe(shim)
  })

  // Why a link in a dir of its own: `/usr/bin` may also hold a real orca-ide, as it does on a
  // packaged install. Why real: the fake above could drift from a distro's. Resolving runs nothing.
  it.runIf(process.platform === 'linux' && existsSync('/usr/bin/orca'))(
    'finds no CLI on a PATH holding only the real /usr/bin/orca',
    () => {
      const onlyReader = tempDir()
      symlinkSync('/usr/bin/orca', join(onlyReader, 'orca'))
      expect(resolveCli({ PATH: onlyReader })).toEqual({ status: 1, path: '' })
    }
  )
})

/** The system's tools minus anything named orca*: a real orca-ide here would reach the real board. */
function toolsWithoutOrca() {
  const tools = tempDir()
  for (const dir of ['/usr/bin', '/bin']) {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (!name.startsWith('orca') && !existsSync(join(tools, name))) {
        symlinkSync(join(dir, name), join(tools, name))
      }
    }
  }
  return tools
}

describe('no hook starts a bare orca', () => {
  const tools = toolsWithoutOrca()

  /** What every hook runs under: the reader first on PATH, and no Orca env to be saved by. */
  function hookEnv(bin, extra = {}) {
    return { HOME: bin, PATH: `${bin}:${tools}`, ...extra }
  }

  it('session-start-plane-board', () => {
    const { bin, started } = fakeReader()
    const result = spawnSync(python, [join(hooksDir, 'session-start-plane-board.py')], {
      encoding: 'utf8',
      env: hookEnv(bin)
    })
    expect(result.status, result.stderr).toBe(0)
    expect(started()).toBe('')
    expect(result.stdout).toContain('NO se pudo leer')
  })

  it('board-state-guard, which denies at once instead of waiting on the reader', () => {
    const { bin, started } = fakeReader()
    stub(bin, 'git', 'echo fabolivark/orca-1018')
    const result = spawnSync(python, [join(hooksDir, 'board-state-guard.py')], {
      encoding: 'utf8',
      input: JSON.stringify({ tool_input: { command: 'gh pr create --title x' } }),
      env: hookEnv(bin)
    })
    expect(result.status, result.stderr).toBe(0)
    expect(started()).toBe('')
    expect(result.stdout).toContain('"permissionDecision": "deny"')
    expect(result.stdout).toContain('No se pudo leer el estado de ORCA-1018')
  })

  it('post-merge-board-close, which says it could not move the ticket', () => {
    const { bin, started } = fakeReader()
    stub(bin, 'gh', `echo '{"state":"MERGED","title":"fix: x (ORCA-99)"}'`)
    const result = spawnSync(python, [join(hooksDir, 'post-merge-board-close.py')], {
      encoding: 'utf8',
      input: JSON.stringify({ tool_input: { command: 'gh pr merge 12 --squash' } }),
      env: hookEnv(bin)
    })
    expect(result.status, result.stderr).toBe(0)
    expect(started()).toBe('')
    expect(result.stdout).toContain('no pude mover')
  })

  it('coordinator-sweep', () => {
    const { bin, started } = fakeReader()
    stub(bin, 'gh', `echo '[]'`)
    const result = spawnSync('bash', [join(hooksDir, 'coordinator-sweep.sh'), '--tick'], {
      encoding: 'utf8',
      env: hookEnv(bin, { ORCA_SWEEP_ROOT: resolve(hooksDir, '../..') })
    })
    expect(result.stdout).toContain('SWEEP')
    expect(started()).toBe('')
  })

  it('merged-worktree-close-hook inside an Orca terminal, which keeps worktrees closed off', () => {
    const { bin, started } = fakeReader()
    const repo = join(bin, 'repo')
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
    mkdirSync(repo)
    git('init', '-q')
    git('-c', 'user.name=t', '-c', 'user.email=t@e.co', 'commit', '-q', '--allow-empty', '-m', 'b')
    const worktree = join(bin, 'fix-a')
    git('worktree', 'add', '-q', '-b', 'fix/a', worktree)
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    const prsFile = join(bin, 'prs.json')
    writeFileSync(prsFile, JSON.stringify({ 'fix/a': [{ number: 12, headRefOid: head }] }))

    const result = spawnSync(process.execPath, [join(hooksDir, 'merged-worktree-close-hook.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: repo,
        tool_input: { command: 'gh workflow run x' }
      }),
      env: hookEnv(bin, {
        ORCA_TERMINAL_HANDLE: 'term_x',
        ORCA_WORKTREE_CLOSE_PRS_FILE: prsFile
      })
    })

    expect(result.status, result.stderr).toBe(0)
    expect(started()).toBe('')
    expect(result.stdout).toContain('terminales de Orca')
    expect(existsSync(worktree)).toBe(true)
  })

  // Why static too: the watchdog has no entry point cheap enough to run here, and a new hook
  // would add its bare call without any test of its own.
  it('leaves no way to a bare orca in any hook source', () => {
    for (const name of readdirSync(hooksDir)) {
      const source = join(hooksDir, name)
      if (name.endsWith('.py') && name !== 'orca_cli.py') {
        expect(readFileSync(source, 'utf8'), name).not.toMatch(/\[\s*"orca"/)
      }
      if (name.endsWith('.sh') && name !== 'orca-cli.sh') {
        const text = readFileSync(source, 'utf8')
        const calls = text.split('\n').some((line) => /^[^#]*(\$\(|\bif\s+|^\s*)orca\s/.test(line))
        expect(calls && !text.includes('orca-cli.sh"'), `${name} calls orca unresolved`).toBe(false)
      }
    }
  })
})
