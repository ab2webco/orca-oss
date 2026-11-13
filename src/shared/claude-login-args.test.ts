import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_LOGIN_ARGS,
  CLAUDE_LOGIN_FALLBACK_ARGS,
  ClaudeCliTooOldError,
  ClaudeLoginFlagCache,
  isClaudeaiUnknownOptionError,
  runWithClaudeLoginFallback
} from './claude-login-args'

const UNKNOWN = new Error("Claude command failed: error: unknown option '--claudeai'")
// Why these two: 1.0.73 (the owner's machine) has no `auth` command, so `auth login` there is a
// prompt, not a sign-in; 2.1.50 has `auth login` but not --claudeai, and signs in to claude.ai.
const HELP_1_0_73 =
  'Usage: claude [options] [command] [prompt]\n\nClaude Code - starts an interactive session'
const HELP_2_1_50 = 'Usage: claude auth login [options]\n\nSign in to your Anthropic account'

const rejectsFlag = () =>
  vi.fn(async (args: readonly string[]) => {
    if (args.includes('--claudeai')) {
      throw UNKNOWN
    }
    return 'signed in'
  })

describe('isClaudeaiUnknownOptionError', () => {
  it('matches only an unknown --claudeai option, as older Claude CLIs print it', () => {
    expect(isClaudeaiUnknownOptionError("error: unknown option '--claudeai'")).toBe(true)
    expect(isClaudeaiUnknownOptionError('error: unknown option --claudeai')).toBe(true)
    expect(isClaudeaiUnknownOptionError("error: unknown option '--console'")).toBe(false)
    expect(isClaudeaiUnknownOptionError('Claude sign-in was cancelled.')).toBe(false)
  })
})

describe('runWithClaudeLoginFallback', () => {
  it('retries once with plain auth login on a CLI that has auth login but not --claudeai', async () => {
    const cache = new ClaudeLoginFlagCache()
    const run = rejectsFlag()

    await expect(
      runWithClaudeLoginFallback(run, 'host:/usr/bin/claude', cache, async () => HELP_2_1_50)
    ).resolves.toBe('signed in')
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      CLAUDE_LOGIN_ARGS,
      CLAUDE_LOGIN_FALLBACK_ARGS
    ])
  })

  it('skips the bad flag on later logins with the same binary, and only there', async () => {
    const cache = new ClaudeLoginFlagCache()
    const run = rejectsFlag()
    const help = vi.fn(async () => HELP_2_1_50)
    await runWithClaudeLoginFallback(run, 'host:/old/claude', cache, help)
    run.mockClear()
    help.mockClear()

    await runWithClaudeLoginFallback(run, 'host:/old/claude', cache, help)
    expect(run.mock.calls.map(([args]) => args)).toEqual([CLAUDE_LOGIN_FALLBACK_ARGS])
    expect(help).not.toHaveBeenCalled()
    expect(cache.argsFor('host:/new/claude')).toEqual(CLAUDE_LOGIN_ARGS)
  })

  it('tells a person on Claude Code 1.0.73 to update instead of running auth login as a prompt', async () => {
    const cache = new ClaudeLoginFlagCache()
    const run = rejectsFlag()

    await expect(
      runWithClaudeLoginFallback(run, 'host:/usr/bin/claude', cache, async () => HELP_1_0_73)
    ).rejects.toBeInstanceOf(ClaudeCliTooOldError)
    expect(run).toHaveBeenCalledTimes(1)
    await expect(
      runWithClaudeLoginFallback(run, 'host:/usr/bin/claude', cache, async () => HELP_1_0_73)
    ).rejects.toThrow(/update Claude Code/)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('never swallows a different failure', async () => {
    const cache = new ClaudeLoginFlagCache()
    const help = vi.fn(async () => HELP_2_1_50)
    const run = vi.fn(async () => {
      throw new Error('Claude sign-in was cancelled.')
    })

    await expect(
      runWithClaudeLoginFallback(run, 'host:/usr/bin/claude', cache, help)
    ).rejects.toThrow('Claude sign-in was cancelled.')
    expect(run).toHaveBeenCalledTimes(1)
    expect(help).not.toHaveBeenCalled()
    expect(cache.argsFor('host:/usr/bin/claude')).toEqual(CLAUDE_LOGIN_ARGS)
  })
})
