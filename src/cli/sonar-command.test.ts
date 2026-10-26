import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runNodeProcess, runSonarCommand } from './sonar-command'

const HASH = 'b'.repeat(64)

describe('runSonarCommand', () => {
  let userDataDir: string
  let pluginDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-sonar-command-'))
    pluginDir = join(userDataDir, 'plugins', 'ab2web.orca-sonar')
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  function installTree(): string {
    mkdirSync(join(pluginDir, HASH, 'bin'), { recursive: true })
    const cliPath = join(pluginDir, HASH, 'bin', 'orca-sonar.ts')
    writeFileSync(cliPath, '')
    writeFileSync(join(pluginDir, 'current'), `${HASH}\n`)
    return cliPath
  }

  it('fails with sonar_not_installed when the plugin is not installed', async () => {
    const run = vi.fn(async () => 0)

    await expect(runSonarCommand(['find', 'Tab'], { userDataDir, run })).rejects.toMatchObject({
      code: 'sonar_not_installed'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the installed CLI with the arguments and Orca userData path', async () => {
    const cliPath = installTree()
    const run = vi.fn(async () => 0)

    await runSonarCommand(['find', 'Tab', '--json'], { userDataDir, run })

    expect(run).toHaveBeenCalledWith('node', [cliPath, 'find', 'Tab', '--json'], {
      ...process.env,
      ORCA_USER_DATA_PATH: userDataDir
    })
  })

  it('returns the CLI exit code unchanged', async () => {
    installTree()

    await expect(
      runSonarCommand(['symbol', 'x'], { userDataDir, run: async () => 2 })
    ).resolves.toBe(2)
  })
})

describe('runNodeProcess', () => {
  it('returns the child exit code and passes its arguments through', async () => {
    // Why: `node -e <code> a b` sees argv [node, 'a', 'b'], so the exit code is 3.
    await expect(
      runNodeProcess('node', ['-e', 'process.exit(process.argv.length)', 'a', 'b'], process.env)
    ).resolves.toBe(3)
  })
})
