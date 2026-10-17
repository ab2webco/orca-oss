import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from './index'

const helpOf = async (argv: string[]): Promise<string> => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  await main(argv, '/tmp/repo')
  return logSpy.mock.calls.flat().join('\n')
}

describe('orca game help', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('lists the game commands for `game --help` and `help game`', async () => {
    for (const argv of [
      ['game', '--help'],
      ['help', 'game']
    ]) {
      const help = await helpOf(argv)
      expect(help).not.toContain('Unknown command')
      expect(help).toContain('Usage: orca game <command> [options]')
      expect(help).toContain('fleet')
      expect(help).toContain('scene new')
      expect(process.exitCode).toBeUndefined()
      vi.restoreAllMocks()
    }
  })

  it('lists only the scene commands for `game scene --help`', async () => {
    const help = await helpOf(['game', 'scene', '--help'])
    expect(help).not.toContain('Unknown command')
    expect(help).toContain('Usage: orca game scene <command> [options]')
    expect(help).toContain('new')
    expect(help).toContain('validate')
    expect(help).not.toContain('fleet')
    expect(process.exitCode).toBeUndefined()
  })

  it('prints a scene command’s own usage for `--help` and `help`', async () => {
    for (const argv of [
      ['game', 'scene', 'new', '--help'],
      ['help', 'game', 'scene', 'new']
    ]) {
      const help = await helpOf(argv)
      expect(help).toContain('Usage: orca game scene new <path> [--json]')
      expect(process.exitCode).toBeUndefined()
      vi.restoreAllMocks()
    }
  })

  it('names the game in the root help', async () => {
    expect(await helpOf(['--help'])).toContain('game                      ')
  })
})
