import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: () => void
}

const childThat = (stdout: string, stderr: string, code: number | 'stay-open'): FakeChild => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  }) as FakeChild
  setTimeout(() => {
    child.stdout.write(stdout)
    child.stderr.write(stderr)
    if (code !== 'stay-open') {
      setTimeout(() => child.emit('close', code), 5)
    }
  }, 5)
  return child
}

const CLAUDE_URL_OUTPUT =
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a\n" +
  'Paste code here if prompted > '

afterEach(() => {
  spawnMock.mockReset()
  vi.resetModules()
})

// ORCA-1039: a paired host's Claude CLI may predate --claudeai, or predate `auth` altogether.
describe('beginHostLogin on an older Claude CLI', () => {
  it('signs in with plain auth login on 2.1.50, which has auth login but not --claudeai', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--claudeai')) {
        return childThat('', "error: unknown option '--claudeai'\n", 1)
      }
      if (args.includes('--help')) {
        return childThat('Usage: claude auth login [options]\n', '', 0)
      }
      return childThat(CLAUDE_URL_OUTPUT, '', 'stay-open')
    })
    const { beginHostLogin, endHostLogin } = await import('./host-login-session')

    const started = await beginHostLogin('claude')

    expect(started.url).toContain('https://claude.com/cai/oauth/authorize')
    expect(spawnMock.mock.calls.map(([, args]) => args)).toEqual([
      ['auth', 'login', '--claudeai'],
      ['auth', 'login', '--help'],
      ['auth', 'login']
    ])
    endHostLogin(started.sessionId)
  })

  it('tells the person to update Claude Code on 1.0.73, which has no auth command', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--help')) {
        return childThat('Usage: claude [options] [command] [prompt]\n', '', 0)
      }
      return childThat('', "error: unknown option '--claudeai'\n", 1)
    })
    const { beginHostLogin } = await import('./host-login-session')

    await expect(beginHostLogin('claude')).rejects.toThrow(/update Claude Code/)
    expect(spawnMock.mock.calls.map(([, args]) => args)).toEqual([
      ['auth', 'login', '--claudeai'],
      ['auth', 'login', '--help']
    ])
  })
})
