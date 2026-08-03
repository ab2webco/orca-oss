import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CodexCliCommandModule from '../shared/node-cli-command-resolution'

const { detectCommandsMock, resolveCliCommandMock, spawnMock } = vi.hoisted(() => ({
  detectCommandsMock: vi.fn(() => new Set<string>(['claude'])),
  resolveCliCommandMock: vi.fn(() => 'npx'),
  spawnMock: vi.fn()
}))

vi.mock('../shared/local-agent-install-dir-detection', () => ({
  detectCommandsInInstallDirs: detectCommandsMock
}))

vi.mock('../shared/node-cli-command-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof CodexCliCommandModule>()),
  resolveCliCommand: resolveCliCommandMock
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

// Why: the shipped registry is version-generated and large; this fixture pins the
// names whose source repository the routing has to get right, and nothing else.
vi.mock('./bundled-skill-guides.js', () => ({
  BUNDLED_SKILL_GUIDES: [
    {
      name: 'orca-cli',
      description: 'Upstream skill.',
      markdown: '# orca-cli\n',
      fullMarkdown: '# orca-cli\n',
      aliases: []
    },
    {
      name: 'orca-plane',
      description: 'Fork-only skill.',
      markdown: '# orca-plane\n',
      fullMarkdown: '# orca-plane\n',
      aliases: []
    },
    {
      name: 'switch-account',
      description: 'Fork-only skill.',
      markdown: '# switch-account\n',
      fullMarkdown: '# switch-account\n',
      aliases: []
    }
  ]
}))

vi.mock('./runtime-client', async () => {
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('./runtime/types.js')

  class RuntimeClient {}

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError,
    serveOrcaApp: vi.fn(),
    getDefaultUserDataPath: vi.fn(() => '/tmp/orca-user-data')
  }
})

import { main } from './index'

const UPSTREAM_URL = 'https://github.com/stablyai/orca'
const FORK_URL = 'https://github.com/ab2webco/orca-oss'

function stdoutText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => String(call[0])).join('')
}

function createFakeChild(): EventEmitter {
  return new EventEmitter()
}

describe('orca skills install source repository routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resolveCliCommandMock.mockReset()
    resolveCliCommandMock.mockReturnValue('npx')
    detectCommandsMock.mockReset()
    detectCommandsMock.mockReturnValue(new Set<string>(['claude']))
    spawnMock.mockReset()
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('installs a fork-only skill from the fork instead of upstream', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(
      ['skills', 'install', '--skill', 'switch-account', '--agent', 'claude-code', '--dry-run'],
      '/tmp/repo'
    )

    expect(stdoutText(stdoutSpy)).toBe(
      `npx --yes skills add ${FORK_URL} --skill switch-account --global --agent claude-code -y\n\n` +
        'Rerun without --dry-run to install now.\n'
    )
  })

  it('keeps upstream skills on the upstream repository', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(
      ['skills', 'install', '--skill', 'orca-cli', '--agent', 'claude-code', '--dry-run'],
      '/tmp/repo'
    )

    expect(stdoutText(stdoutSpy)).toBe(
      `npx --yes skills add ${UPSTREAM_URL} --skill orca-cli --global --agent claude-code -y\n\n` +
        'Rerun without --dry-run to install now.\n'
    )
  })

  it('splits a mixed request into one command per repository', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(
      [
        'skills',
        'install',
        '--skill',
        'orca-cli',
        '--skill',
        'switch-account',
        '--agent',
        'claude-code',
        '--dry-run'
      ],
      '/tmp/repo'
    )

    expect(stdoutText(stdoutSpy)).toBe(
      `npx --yes skills add ${UPSTREAM_URL} --skill orca-cli --global --agent claude-code -y\n` +
        `npx --yes skills add ${FORK_URL} --skill switch-account --global --agent claude-code -y\n\n` +
        'Rerun without --dry-run to install now.\n'
    )
  })

  it('covers both repositories for --all', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['skills', 'install', '--all', '--agent', 'claude-code', '--dry-run'], '/tmp/repo')

    expect(stdoutText(stdoutSpy)).toBe(
      `npx --yes skills add ${UPSTREAM_URL} --skill orca-cli --global --agent claude-code -y\n` +
        `npx --yes skills add ${FORK_URL} --skill orca-plane --skill switch-account --global ` +
        '--agent claude-code -y\n\n' +
        'Rerun without --dry-run to install now.\n'
    )
  })

  it('spawns exactly the argv --dry-run printed, one child per repository', async () => {
    // Why: a test that pins only the dry-run text lets the real run drift away
    // from it, which is the failure this ticket shipped.
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await main(
      [
        'skills',
        'install',
        '--skill',
        'orca-cli',
        '--skill',
        'switch-account',
        '--agent',
        'claude-code',
        '--dry-run'
      ],
      '/tmp/repo'
    )
    const promised = stdoutText(stdoutSpy)
      .split('\n\n')[0]
      .split('\n')
      .map((line) => line.replace(/^npx /, '').split(' '))
    stdoutSpy.mockRestore()

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const children = [createFakeChild(), createFakeChild()]
    spawnMock.mockImplementation(() => children[spawnMock.mock.calls.length - 1])

    const runPromise = main(
      [
        'skills',
        'install',
        '--skill',
        'orca-cli',
        '--skill',
        'switch-account',
        '--agent',
        'claude-code'
      ],
      '/tmp/repo'
    )
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    children[0].emit('exit', 0, null)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
    children[1].emit('exit', 0, null)
    await runPromise

    expect(spawnMock.mock.calls.map((call) => call[1])).toEqual(promised)
    expect(process.exitCode).toBe(0)
  })

  it('still runs the other repository when the first command fails, and reports its code', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const children = [createFakeChild(), createFakeChild()]
    spawnMock.mockImplementation(() => children[spawnMock.mock.calls.length - 1])

    const runPromise = main(
      [
        'skills',
        'install',
        '--skill',
        'orca-cli',
        '--skill',
        'switch-account',
        '--agent',
        'claude-code'
      ],
      '/tmp/repo'
    )
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
    children[0].emit('exit', 3, null)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2))
    children[1].emit('exit', 0, null)
    await runPromise

    expect(spawnMock.mock.calls[1][1]).toContain(FORK_URL)
    expect(process.exitCode).toBe(3)
  })

  it('updates without a repository, since the skills lock records each source', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await main(['skills', 'update', '--all', '--dry-run', '--json'], '/tmp/repo')

    expect(JSON.parse(stdoutText(stdoutSpy))).toEqual({
      commands: ['npx --yes skills update orca-cli orca-plane switch-account --global -y'],
      skills: ['orca-cli', 'orca-plane', 'switch-account'],
      global: true,
      executed: false
    })
  })
})
