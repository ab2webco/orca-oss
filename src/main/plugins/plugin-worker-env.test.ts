import { describe, expect, it } from 'vitest'
import { buildPluginWorkerEnv } from './plugin-worker-env'

describe('buildPluginWorkerEnv', () => {
  it('matches allowlisted keys case-sensitively on POSIX', () => {
    expect(
      buildPluginWorkerEnv(
        { PATH: '/safe', path: '/wrong', HOME: '/home', NODE_OPTIONS: '--inspect' },
        'linux'
      )
    ).toEqual({ PATH: '/safe', HOME: '/home', ELECTRON_RUN_AS_NODE: '1' })
  })

  it('forwards the userData location so a worker reaches this app runtime', () => {
    expect(
      buildPluginWorkerEnv(
        {
          ORCA_USER_DATA_PATH: '/home/me/.config/orca-ide',
          XDG_CONFIG_HOME: '/home/me/.config',
          ORCA_PAIRING_CODE: 'secret'
        },
        'linux'
      )
    ).toEqual({
      ORCA_USER_DATA_PATH: '/home/me/.config/orca-ide',
      XDG_CONFIG_HOME: '/home/me/.config',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('matches Windows environment keys case-insensitively', () => {
    expect(buildPluginWorkerEnv({ Path: 'C:\\safe', systemroot: 'C:\\Windows' }, 'win32')).toEqual({
      PATH: 'C:\\safe',
      SystemRoot: 'C:\\Windows',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('points every home variable at the given home and never the user one (ORCA-1113)', () => {
    const userHome = { HOME: '/home/me', XDG_CONFIG_HOME: '/home/me/.config' }
    const env = buildPluginWorkerEnv(userHome, 'linux', '/profile/plugin-home')
    expect(env).toMatchObject({
      HOME: '/profile/plugin-home',
      XDG_CONFIG_HOME: '/profile/plugin-home/.config'
    })
    expect(Object.values(env)).not.toContain('/home/me')
    expect(Object.values(env)).not.toContain('/home/me/.config')
  })

  it('replaces USERPROFILE on Windows, where os.homedir() reads it', () => {
    const env = buildPluginWorkerEnv(
      { USERPROFILE: 'C:\\Users\\me', HOME: 'C:\\Users\\me' },
      'win32',
      'C:\\Orca\\plugin-home'
    )
    expect(env).toMatchObject({
      USERPROFILE: 'C:\\Orca\\plugin-home',
      HOME: 'C:\\Orca\\plugin-home',
      XDG_CONFIG_HOME: 'C:\\Orca\\plugin-home\\.config'
    })
  })
})
