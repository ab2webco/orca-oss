import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runNodeProcess, runSonarCommand } from './sonar-command'

const HASH = 'b'.repeat(64)
const activeSonar = async () => [{ pluginKey: 'ab2web.orca-sonar', status: 'idle' }]

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

    await expect(
      runSonarCommand(['find', 'Tab'], { userDataDir, run, listPlugins: activeSonar })
    ).rejects.toMatchObject({
      code: 'sonar_not_installed'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the installed CLI with the arguments and Orca userData path', async () => {
    const cliPath = installTree()
    const run = vi.fn(async () => 0)

    await runSonarCommand(['find', 'Tab', '--json'], { userDataDir, run, listPlugins: activeSonar })

    expect(run).toHaveBeenCalledWith('node', [cliPath, 'find', 'Tab', '--json'], {
      ...process.env,
      ORCA_USER_DATA_PATH: userDataDir
    })
  })

  it('refuses on a remote Orca host before looking for the install', async () => {
    installTree()
    const run = vi.fn(async () => 0)

    await expect(
      runSonarCommand(['find', 'Tab'], { userDataDir, run, remote: true, listPlugins: activeSonar })
    ).rejects.toMatchObject({
      code: 'sonar_remote_unavailable',
      message: expect.stringContaining('remote Orca host')
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns the CLI exit code unchanged', async () => {
    installTree()

    await expect(
      runSonarCommand(['symbol', 'x'], {
        userDataDir,
        run: async () => 2,
        listPlugins: activeSonar
      })
    ).resolves.toBe(2)
  })

  it.each([
    ['the plugin system is off', [], 'Turn on plugins'],
    [
      'the plugin is disabled',
      [{ pluginKey: 'ab2web.orca-sonar', status: 'disabled' }],
      'disabled'
    ],
    [
      'an update waits for consent',
      [{ pluginKey: 'ab2web.orca-sonar', status: 'pending' }],
      'approve'
    ],
    [
      'the plugin is kill-listed',
      [
        {
          pluginKey: 'ab2web.orca-sonar',
          status: 'errored',
          blockedByKillList: { reason: 'bad release' }
        }
      ],
      'safety list'
    ],
    ['the install is invalid', [{ pluginKey: 'ab2web.orca-sonar', status: 'invalid' }], 'Reinstall']
  ])('refuses with sonar_plugin_inactive when %s', async (_state, plugins, hint) => {
    installTree()
    const run = vi.fn(async () => 0)

    await expect(
      runSonarCommand(['find', 'Tab'], { userDataDir, run, listPlugins: async () => plugins })
    ).rejects.toMatchObject({
      code: 'sonar_plugin_inactive',
      message: expect.stringContaining(hint)
    })
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['running', 'idle', 'restarting', 'errored'])(
    'runs the CLI while Orca reports the plugin %s',
    async (status) => {
      installTree()
      const run = vi.fn(async () => 0)

      await runSonarCommand(['find', 'Tab'], {
        userDataDir,
        run,
        listPlugins: async () => [
          { pluginKey: 'other.plugin', status: 'disabled' },
          { pluginKey: 'ab2web.orca-sonar', status }
        ]
      })

      expect(run).toHaveBeenCalledOnce()
    }
  )

  it('does not ask Orca when the plugin is not installed', async () => {
    const listPlugins = vi.fn(activeSonar)

    await expect(
      runSonarCommand(['find', 'Tab'], { userDataDir, run: async () => 0, listPlugins })
    ).rejects.toMatchObject({ code: 'sonar_not_installed' })
    expect(listPlugins).not.toHaveBeenCalled()
  })

  it('does not run the CLI when Orca cannot be asked', async () => {
    installTree()
    const run = vi.fn(async () => 0)
    const unreachable = Object.assign(new Error('Orca Lab is not running.'), {
      code: 'runtime_unavailable'
    })

    await expect(
      runSonarCommand(['find', 'Tab'], {
        userDataDir,
        run,
        listPlugins: async () => {
          throw unreachable
        }
      })
    ).rejects.toBe(unreachable)
    expect(run).not.toHaveBeenCalled()
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
