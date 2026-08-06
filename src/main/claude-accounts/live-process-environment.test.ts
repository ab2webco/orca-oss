import { describe, expect, it } from 'vitest'
import { readLiveProcessEnvironmentValue } from './live-process-environment'

describe('readLiveProcessEnvironmentValue', () => {
  it('reads a value from /proc on Linux', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'linux',
      readProcEnviron: async () => 'SHELL=/bin/zsh\0CLAUDE_CONFIG_DIR=/vaults/a/auth\0TERM=xterm\0'
    })

    expect(result).toEqual({ value: '/vaults/a/auth' })
  })

  it('reports a Linux process without the variable as absent, not unreadable', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'linux',
      readProcEnviron: async () => 'SHELL=/bin/zsh\0TERM=xterm\0'
    })

    expect(result).toEqual({ value: null })
  })

  it('reports an unreadable /proc entry as unreadable', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'linux',
      readProcEnviron: async () => {
        throw new Error('ESRCH')
      }
    })

    expect(result).toBeNull()
  })

  it('parses a value containing spaces out of ps output', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'darwin',
      readPsEnvironment: async () =>
        '/bin/zsh -l SHELL=/bin/zsh CLAUDE_CONFIG_DIR=/Users/me/My Vaults/a/auth TERM=xterm-256color\n'
    })

    expect(result).toEqual({ value: '/Users/me/My Vaults/a/auth' })
  })

  it('reads a trailing ps entry with no following variable', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'darwin',
      readPsEnvironment: async () => '/bin/zsh -l CLAUDE_CONFIG_DIR=/vaults/a/auth\n'
    })

    expect(result).toEqual({ value: '/vaults/a/auth' })
  })

  it('reports a darwin process without the variable as absent', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'darwin',
      readPsEnvironment: async () => '/bin/zsh -l SHELL=/bin/zsh TERM=xterm-256color\n'
    })

    expect(result).toEqual({ value: null })
  })

  it('reports an empty ps listing as unreadable rather than absent', async () => {
    const result = await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', {
      platform: 'darwin',
      readPsEnvironment: async () => '\n'
    })

    expect(result).toBeNull()
  })

  it('is unreadable on Windows, which exposes no other process environment', async () => {
    expect(
      await readLiveProcessEnvironmentValue(4321, 'CLAUDE_CONFIG_DIR', { platform: 'win32' })
    ).toBeNull()
  })

  it('is unreadable without a usable pid', async () => {
    expect(
      await readLiveProcessEnvironmentValue(0, 'CLAUDE_CONFIG_DIR', { platform: 'linux' })
    ).toBeNull()
    expect(
      await readLiveProcessEnvironmentValue(-1, 'CLAUDE_CONFIG_DIR', { platform: 'linux' })
    ).toBeNull()
  })
})
