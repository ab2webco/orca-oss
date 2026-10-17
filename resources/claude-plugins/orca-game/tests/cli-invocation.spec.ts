import { describe, expect, it } from 'vitest'

import { CLI_LINE_ENV, cliInvocationOf } from '../hooks/cli-invocation'

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe'

describe('cliInvocationOf', () => {
  it('runs an executable CLI by its argv, as before', () => {
    expect(cliInvocationOf(['/opt/orca', 'game', 'state', '--json'], undefined)).toEqual({
      argv: ['/opt/orca', 'game', 'state', '--json']
    })
  })

  it('hands Windows a native spelling of a forward-slash drive path', () => {
    expect(
      cliInvocationOf(['C:/Program Files/Orca/resources/bin/orca.exe', 'game', 'state'], COMSPEC)
    ).toEqual({ argv: ['C:\\Program Files\\Orca\\resources\\bin\\orca.exe', 'game', 'state'] })
  })

  it('runs a .cmd CLI through cmd.exe with its line in the env, never re-parsed as argv', () => {
    const url = 'https://jira.example/browse/CIN-1?a=1&b=%20(x)^!y!'
    expect(
      cliInvocationOf(
        ['C:/Users/Zoë (dev)/orca-dev 100%/orca-dev.CMD', 'game', 'open-link', '--url', url],
        COMSPEC
      )
    ).toEqual({
      argv: [COMSPEC, '/d', '/v:off', '/s', '/c', `%${CLI_LINE_ENV}%`],
      env: {
        [CLI_LINE_ENV]: `"C:\\Users\\Zoë (dev)\\orca-dev 100%\\orca-dev.CMD" "game" "open-link" "--url" "${url}"`
      }
    })
  })

  it('keeps a trailing backslash from escaping the closing quote', () => {
    expect(cliInvocationOf(['C:\\o\\orca.bat', 'C:\\dir\\'], COMSPEC)?.env).toEqual({
      [CLI_LINE_ENV]: '"C:\\o\\orca.bat" "C:\\dir\\\\"'
    })
  })

  it('refuses what cmd.exe cannot carry safely, or a cmd.exe it would have to look up', () => {
    expect(cliInvocationOf(['C:\\o\\orca.cmd', 'say "hi"'], COMSPEC)).toBeUndefined()
    expect(cliInvocationOf(['C:\\o\\orca.cmd', 'two\nlines'], COMSPEC)).toBeUndefined()
    expect(cliInvocationOf(['C:\\o\\orca.cmd', 'game'], 'cmd.exe')).toBeUndefined()
    expect(cliInvocationOf(['C:\\o\\orca.cmd', 'game'], undefined)).toBeUndefined()
  })
})
