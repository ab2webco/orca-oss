import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { APPIMAGE_CLI_COMMAND_ROOTS } from '../../shared/appimage-cli-command-roots'
import { getAppImageCliArgs, maybeRedirectAppImageCliLaunch } from './appimage-cli-redirect'

const commandNames = ['serve', 'status', 'terminal']

// Why: the shipped allow-list, not the trimmed one above — these cases assert
// what a real AppImage launch does.
const realListOptions = {
  platform: 'linux',
  isPackaged: true,
  commandNames: APPIMAGE_CLI_COMMAND_ROOTS
} as const

describe('AppImage CLI redirect', () => {
  it('detects direct AppImage CLI commands', () => {
    expect(
      getAppImageCliArgs(
        ['orca-linux.AppImage', 'status', '--json'],
        { APPIMAGE: '/opt/orca' },
        {
          platform: 'linux',
          isPackaged: true,
          commandNames
        }
      )
    ).toEqual(['status', '--json'])
  })

  it('allows CLI global flags before the command', () => {
    expect(
      getAppImageCliArgs(
        ['orca-linux.AppImage', '--pairing-code', 'abc123', '--json', 'terminal', 'list'],
        {
          APPIMAGE: '/opt/orca'
        },
        {
          platform: 'linux',
          isPackaged: true,
          commandNames
        }
      )
    ).toEqual(['--pairing-code', 'abc123', '--json', 'terminal', 'list'])
  })

  it('does not redirect normal desktop AppImage launches', () => {
    expect(
      getAppImageCliArgs(
        ['AppRun', '--no-sandbox', 'file:///tmp/example.txt'],
        {
          APPIMAGE: '/opt/orca'
        },
        {
          platform: 'linux',
          isPackaged: true,
          commandNames
        }
      )
    ).toBeNull()
  })

  it('routes no-sandbox serve launches through the CLI', () => {
    expect(
      getAppImageCliArgs(
        ['AppRun', '--no-sandbox', 'serve', '--port', '6768'],
        { APPIMAGE: '/opt/orca' },
        {
          platform: 'linux',
          isPackaged: true,
          commandNames
        }
      )
    ).toEqual(['serve', '--port', '6768'])
  })

  it('removes no-sandbox before forwarding CLI help', () => {
    expect(
      getAppImageCliArgs(
        ['AppRun', '--no-sandbox', 'serve', '--help'],
        { APPIMAGE: '/opt/orca' },
        {
          platform: 'linux',
          isPackaged: true,
          commandNames
        }
      )
    ).toEqual(['serve', '--help'])
  })

  // Why (ORCA-138): this exact argv booted the GUI, hit EADDRINUSE on the
  // ws-transport port, handed off to the live window, and exited with no output.
  it('redirects the reported `plane` invocation instead of booting the GUI', () => {
    expect(
      getAppImageCliArgs(
        ['orca-linux.AppImage', 'plane', 'project', 'list', '--json'],
        { APPIMAGE: '/opt/orca/orca-linux.AppImage' },
        realListOptions
      )
    ).toEqual(['plane', 'project', 'list', '--json'])
  })

  it('redirects every allow-listed root command', () => {
    const notRedirected = APPIMAGE_CLI_COMMAND_ROOTS.filter(
      (root) =>
        getAppImageCliArgs(
          ['orca-linux.AppImage', root, '--json'],
          { APPIMAGE: '/opt/orca/orca-linux.AppImage' },
          realListOptions
        ) === null
    )
    expect(notRedirected).toEqual([])
  })

  // Why: widening the allow-list must not turn a desktop file/URL launch into a
  // CLI run — the AppImage still has to boot the GUI for those.
  it('still boots the GUI for desktop launches and unknown positionals', () => {
    for (const argv of [
      ['AppRun', '--no-sandbox', 'file:///tmp/example.txt'],
      ['AppRun', 'orca://pair?payload=abc'],
      ['AppRun', 'definitely-not-a-command']
    ]) {
      expect(
        getAppImageCliArgs(argv, { APPIMAGE: '/opt/orca/orca-linux.AppImage' }, realListOptions)
      ).toBeNull()
    }
  })

  it('spawns the unpacked CLI entrypoint with Electron node mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-appimage-cli-redirect-'))
    const cliEntryPath = join(root, 'app.asar.unpacked', 'out', 'cli', 'index.js')
    await mkdir(join(root, 'app.asar.unpacked', 'out', 'cli'), { recursive: true })
    await writeFile(cliEntryPath, '', 'utf8')
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    const result = maybeRedirectAppImageCliLaunch({
      argv: ['orca-linux.AppImage', 'status', '--json'],
      env: {
        APPIMAGE: '/opt/orca/orca-linux.AppImage',
        NODE_OPTIONS: '--inspect',
        NODE_REPL_EXTERNAL_MODULE: '/tmp/repl.js'
      },
      platform: 'linux',
      isPackaged: true,
      resourcesPath: root,
      execPath: '/opt/orca/orca-ide',
      commandNames,
      spawn: spawn as never
    })

    expect(result).toEqual({ redirected: true, status: 0 })
    expect(spawn).toHaveBeenCalledWith('/opt/orca/orca-ide', [cliEntryPath, 'status', '--json'], {
      env: expect.objectContaining({
        APPIMAGE: '/opt/orca/orca-linux.AppImage',
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_NODE_OPTIONS: '--inspect',
        ORCA_NODE_REPL_EXTERNAL_MODULE: '/tmp/repl.js'
      }),
      stdio: 'inherit'
    })
    const spawnOptions = spawn.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv } | undefined
    expect(spawnOptions?.env).not.toHaveProperty('NODE_OPTIONS')
    expect(spawnOptions?.env).not.toHaveProperty('NODE_REPL_EXTERNAL_MODULE')
  })

  it('forwards an explicit no-sandbox choice to the serve child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-appimage-cli-redirect-'))
    const cliEntryPath = join(root, 'app.asar.unpacked', 'out', 'cli', 'index.js')
    await mkdir(join(root, 'app.asar.unpacked', 'out', 'cli'), { recursive: true })
    await writeFile(cliEntryPath, '', 'utf8')
    const spawn = vi.fn((..._args: unknown[]) => ({ status: 0 }))

    maybeRedirectAppImageCliLaunch({
      argv: ['orca-linux.AppImage', '--no-sandbox', 'serve'],
      env: { APPIMAGE: '/opt/orca/orca-linux.AppImage' },
      platform: 'linux',
      isPackaged: true,
      resourcesPath: root,
      execPath: '/opt/orca/orca-ide',
      commandNames,
      spawn: spawn as never
    })

    expect(spawn).toHaveBeenCalledWith(
      '/opt/orca/orca-ide',
      [cliEntryPath, 'serve'],
      expect.objectContaining({
        env: expect.objectContaining({ ORCA_APPIMAGE_NO_SANDBOX: '1' })
      })
    )
  })
})
