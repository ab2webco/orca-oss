import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyGhPrCapShimEnv,
  POSIX_GH_PR_CAP_WRAPPER,
  WIN32_GH_PR_CAP_WRAPPER
} from './gh-pr-cap-shim'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function setup(orcaExit: number | null) {
  const root = mkdtempSync(join(tmpdir(), 'gh-pr-cap-'))
  roots.push(root)
  const wrap = join(root, 'wrap')
  const bin = join(root, 'bin')
  const tools = join(root, 'tools')
  mkdirSync(wrap)
  mkdirSync(bin)
  mkdirSync(tools)
  // Why only dirname, not /usr/bin: Ubuntu's /usr/bin/orca is GNOME's screen reader, which
  // the wrapper would run as a found Orca CLI (ORCA-1407).
  const dirname = ['/usr/bin/dirname', '/bin/dirname'].find((path) => existsSync(path))
  symlinkSync(dirname ?? '/usr/bin/dirname', join(tools, 'dirname'))
  const script = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
  }
  script(join(wrap, 'gh'), POSIX_GH_PR_CAP_WRAPPER.replace('#!/bin/sh\n', ''))
  script(join(bin, 'gh'), `echo "real gh $*" >> "${root}/log"`)
  if (orcaExit !== null) {
    script(
      join(bin, 'orca'),
      `echo "orca $*" >> "${root}/log"\n[ ${orcaExit} -eq 3 ] && echo "refused here" >&2\nexit ${orcaExit}`
    )
  }
  const runWith = (env: Record<string, string>, ...args: string[]) => {
    const result = spawnSync(join(wrap, 'gh'), args, {
      env: { PATH: `${wrap}:${bin}:${tools}`, ...env },
      encoding: 'utf8'
    })
    let log = ''
    try {
      log = readFileSync(join(root, 'log'), 'utf8')
    } catch {}
    return { status: result.status, stderr: result.stderr, log }
  }
  const run = (...args: string[]) => runWith({}, ...args)
  return { root, script, run, runWith }
}

describe.skipIf(process.platform === 'win32')('the POSIX gh wrapper (ORCA-1301)', () => {
  it('never asks Orca for any gh call but pr create', () => {
    const { run } = setup(3)
    expect(run('pr', 'list')).toMatchObject({ status: 0, log: 'real gh pr list\n' })
    expect(run('pr', 'view', 'create')).toMatchObject({ status: 0 })
    expect(run('api', 'repos')).toMatchObject({ status: 0 })
    expect(run('pr', 'list').log).not.toContain('orca')
  })

  it("refuses gh pr create when Orca's check exits 3, and gh never runs", () => {
    const { run } = setup(3)
    const result = run('-R', 'acme/widgets', 'pr', 'create', '--fill')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refused here')
    expect(result.log).toBe('orca game pr-cap-check\n')
  })

  it('runs gh pr create when the check passes or says it did not check', () => {
    expect(setup(0).run('pr', 'create').log).toBe('orca game pr-cap-check\nreal gh pr create\n')
    expect(setup(4).run('--repo=acme/widgets', 'pr', 'create').log).toContain(
      'real gh --repo=acme/widgets pr create'
    )
  })

  it('runs gh and says the cap went unchecked when the orca CLI is missing', () => {
    const result = setup(null).run('pr', 'create')
    expect(result.status).toBe(0)
    expect(result.log).toBe('real gh pr create\n')
    expect(result.stderr).toMatch(/did not check this project's open-PR cap \(orca exited 127\)/)
  })

  it("asks the member's absolute ORCA_GAME_CLI, not the orca first on PATH (ORCA-1371)", () => {
    // Why: the PATH orca stands in for GNOME's screen reader, which a user rc can put first.
    const { root, script, runWith } = setup(1)
    const cli = join(root, 'orca-ide')
    script(cli, `echo "orca-ide $*" >> "${root}/log"\nexit 0`)
    const result = runWith({ ORCA_GAME_CLI: cli }, 'pr', 'create')
    expect(result.log).toBe('orca-ide game pr-cap-check\nreal gh pr create\n')
    expect(result.stderr).toBe('')
  })

  it('falls back to orca on PATH when ORCA_GAME_CLI is bare or no longer exists', () => {
    for (const cli of ['orca-ide', '/nonexistent/orca-ide']) {
      expect(setup(0).runWith({ ORCA_GAME_CLI: cli }, 'pr', 'create').log).toBe(
        'orca game pr-cap-check\nreal gh pr create\n'
      )
    }
  })
})

describe('applyGhPrCapShimEnv (ORCA-1301)', () => {
  const dirs = { posixDir: '/u/orca-gh-pr-cap/posix', win32Dir: 'C:\\u\\orca-gh-pr-cap\\win32' }

  it("puts the wrapper first on a POSIX pane's PATH, once", () => {
    const env = { PATH: `/usr/bin:${dirs.posixDir}:/bin` }
    expect(
      applyGhPrCapShimEnv(env, { userDataPath: '/u', platform: 'linux', ensure: () => dirs })
    ).toBe(true)
    expect(env.PATH).toBe(`${dirs.posixDir}:/usr/bin:/bin`)
  })

  it('keeps PATH and says the wrapper is missing when it cannot be written', () => {
    const env = { PATH: '/usr/bin' }
    const installed = applyGhPrCapShimEnv(env, {
      userDataPath: '/u',
      platform: 'darwin',
      ensure: () => {
        throw new Error('EACCES')
      }
    })
    expect(installed).toBe(false)
    expect(env.PATH).toBe('/usr/bin')
  })

  it('uses the POSIX wrapper for Git Bash on Windows, and the .cmd for cmd and PowerShell', () => {
    const bash = { Path: 'C:\\Git\\bin' }
    applyGhPrCapShimEnv(bash, {
      userDataPath: 'C:\\u',
      platform: 'win32',
      shellFamily: 'posix',
      ensure: () => dirs
    })
    expect(bash.Path.split(';')[0]).toBe(dirs.posixDir)
    const cmd: Record<string, string> = { Path: 'C:\\nowhere' }
    // Why false: with no gh to hand off to, the .cmd would only break gh.
    expect(
      applyGhPrCapShimEnv(cmd, {
        userDataPath: 'C:\\u',
        platform: 'win32',
        shellFamily: 'native-windows',
        ensure: () => dirs
      })
    ).toBe(false)
    expect(cmd.Path).toBe('C:\\nowhere')
  })

  it("installs the .cmd only in a game member's pane, never in another cmd or PowerShell pane", () => {
    const plain: Record<string, string> = { Path: 'C:\\Windows' }
    expect(
      applyGhPrCapShimEnv(plain, { userDataPath: 'C:\\u', platform: 'win32', ensure: () => dirs })
    ).toBe(false)
    expect(plain.Path).toBe('C:\\Windows')
  })

  it('the .cmd asks Orca only for pr create and hands every call to the next gh', () => {
    const lines = WIN32_GH_PR_CAP_WRAPPER.split('\n')
    expect(lines.filter((line) => line.includes('pr-cap-check'))).toEqual([
      'call orca game pr-cap-check'
    ])
    expect(WIN32_GH_PR_CAP_WRAPPER).toContain('if not defined orca_pr goto run')
    expect(WIN32_GH_PR_CAP_WRAPPER).toContain('if "%orca_code%"=="3" exit /b 1')
    expect(WIN32_GH_PR_CAP_WRAPPER).toContain('"%ORCA_PR_CAP_NEXT_GH%" %*')
  })
})
