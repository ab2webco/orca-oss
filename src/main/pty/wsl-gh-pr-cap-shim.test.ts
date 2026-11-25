import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWslInteractiveLoginShellCommand } from '../../shared/wsl-login-shell-command'
import { applyGhPrCapShimEnv, applyWslGhPrCapShimEnv, GH_PR_CAP_MEMBER_ENV } from './gh-pr-cap-shim'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'wsl-gh-pr-cap-'))
  roots.push(root)
  return root
}

// Why a fake getent and login shell: the WSL launch then execs a shell that runs one gh pr create.
function wslPane(paneEnv: Record<string, string>) {
  const root = tempRoot()
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const log = join(root, 'log')
  const script = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  script('gh', `echo "real gh $*" >> "${log}"`)
  script('orca-ide', `echo "orca-ide $*" >> "${log}"\necho "refused here" >&2\nexit 3`)
  script('getent', 'exit 2')
  script('member-shell', `gh pr create --fill\necho "gh exited $?" >> "${log}"`)
  const env = { ...paneEnv }
  applyWslGhPrCapShimEnv(env, { userDataPath: join(root, 'user-data') })
  const result = spawnSync('/bin/sh', ['-c', buildWslInteractiveLoginShellCommand()], {
    // Why no WSLENV here: wsl.exe's /p translation hands the guest this same dir as a Linux path.
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      SHELL: join(bin, 'member-shell'),
      ORCA_CLI_COMMAND: 'orca-ide',
      ...(env.ORCA_GH_PR_CAP_SHIM_DIR
        ? { ORCA_GH_PR_CAP_SHIM_DIR: env.ORCA_GH_PR_CAP_SHIM_DIR }
        : {})
    },
    encoding: 'utf8'
  })
  return { stderr: result.stderr, log: readFileSync(log, 'utf8') }
}

describe.skipIf(process.platform === 'win32')('a WSL pane gh pr create (ORCA-1388)', () => {
  it("refuses a Codex member's gh pr create at the cap through the distro's orca-ide", () => {
    const result = wslPane({ [GH_PR_CAP_MEMBER_ENV]: '1' })
    expect(result.log).toBe('orca-ide game pr-cap-check\ngh exited 1\n')
    expect(result.stderr).toContain('refused here')
  })

  it("leaves a plain WSL pane's gh alone and never asks Orca", () => {
    expect(wslPane({}).log).toBe('real gh pr create --fill\ngh exited 0\n')
  })
})

describe('applyWslGhPrCapShimEnv (ORCA-1388)', () => {
  const dirs = {
    posixDir: 'C:\\u\\orca-gh-pr-cap\\posix',
    win32Dir: 'C:\\u\\orca-gh-pr-cap\\win32'
  }

  it("names the POSIX wrapper dir for any member's WSL pane and leaves the Windows PATH", () => {
    const members: Record<string, string>[] = [
      { [GH_PR_CAP_MEMBER_ENV]: '1' },
      { ORCA_GAME_ROLE: 'member' }
    ]
    for (const member of members) {
      const env: Record<string, string> = { Path: 'C:\\Windows', ...member }
      expect(applyWslGhPrCapShimEnv(env, { userDataPath: 'C:\\u', ensure: () => dirs })).toBe(true)
      expect(env.ORCA_GH_PR_CAP_SHIM_DIR).toBe(dirs.posixDir)
      expect(env.Path).toBe('C:\\Windows')
    }
  })

  it('drops an inherited wrapper dir from a non-member pane, or when the wrapper cannot be written', () => {
    const plain: Record<string, string> = { ORCA_GH_PR_CAP_SHIM_DIR: 'C:\\other' }
    expect(applyWslGhPrCapShimEnv(plain, { userDataPath: 'C:\\u', ensure: () => dirs })).toBe(false)
    expect(plain.ORCA_GH_PR_CAP_SHIM_DIR).toBeUndefined()
    const broken: Record<string, string> = { [GH_PR_CAP_MEMBER_ENV]: '1' }
    const ensure = () => {
      throw new Error('EACCES')
    }
    expect(applyWslGhPrCapShimEnv(broken, { userDataPath: 'C:\\u', ensure })).toBe(false)
    expect(broken.ORCA_GH_PR_CAP_SHIM_DIR).toBeUndefined()
  })
})

describe.runIf(process.platform === 'win32')('the .cmd wrapper for a Codex member', () => {
  it('installs in a native Windows member pane that carries no ORCA_GAME_ROLE', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'gh.exe'), '')
    const env: Record<string, string> = { Path: root, [GH_PR_CAP_MEMBER_ENV]: '1' }
    expect(applyGhPrCapShimEnv(env, { userDataPath: join(root, 'user-data') })).toBe(true)
    expect(env.ORCA_PR_CAP_NEXT_GH).toBe(join(root, 'gh.exe'))
  })
})
