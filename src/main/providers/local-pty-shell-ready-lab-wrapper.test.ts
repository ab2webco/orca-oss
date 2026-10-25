import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBashShellReadyRcfileContent } from './local-pty-shell-ready-bash-rcfile'
import {
  describePosix,
  importFreshLocalPtyShellReady,
  restoreUserDataPathAfterEach,
  setTestUserDataPath
} from './local-pty-shell-ready-test-harness'

restoreUserDataPathAfterEach()

describePosix('Orca Lab shell-ready wrappers', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-lab-wrapper-userdata-'))
    setTestUserDataPath(userDataPath)
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('suppresses the oh-my-zsh update prompt that eats the launch command (ORCA-210)', async () => {
    const { getShellReadyLaunchConfig } = await importFreshLocalPtyShellReady()

    expect(getShellReadyLaunchConfig('/bin/zsh').env.DISABLE_AUTO_UPDATE).toBe('true')
  })

  it('restores the attribution shim on PATH in every wrapper after user startup files', async () => {
    const { getShellReadyLaunchConfig } = await importFreshLocalPtyShellReady()
    getShellReadyLaunchConfig('/bin/zsh')
    const zshrc = readFileSync(join(userDataPath, 'shell-ready', 'zsh', '.zshrc'), 'utf8')
    const zlogin = readFileSync(join(userDataPath, 'shell-ready', 'zsh', '.zlogin'), 'utf8')

    expect(zshrc).toContain('[[ ! -o login ]] && __orca_restore_attribution_path')
    expect(zlogin).toMatch(/^__orca_restore_attribution_path$/m)
    expect(getBashShellReadyRcfileContent()).toMatch(/^__orca_restore_attribution_path$/m)
  })

  it('names Orca Lab in the generated wrapper headers', async () => {
    const { getShellReadyLaunchConfig } = await importFreshLocalPtyShellReady()
    getShellReadyLaunchConfig('/bin/zsh')
    const zshrc = readFileSync(join(userDataPath, 'shell-ready', 'zsh', '.zshrc'), 'utf8')

    expect(zshrc.startsWith('# Orca Lab zsh shell-ready wrapper')).toBe(true)
    expect(getBashShellReadyRcfileContent().startsWith('# Orca Lab bash shell-ready wrapper')).toBe(
      true
    )
  })
})
