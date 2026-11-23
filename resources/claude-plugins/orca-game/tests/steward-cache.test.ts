// Runs under `claude plugin test`: the steward reads the member's prompt cache before a model switch (ORCA-1350).
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const OPUS_HIGH = { model: 'claude-opus-5-5', effort: 'high' } as const
const PLAN = [
  { phase: 'implement', model: 'claude-opus-5-5', effort: 'high', why: 'edit' },
  { phase: 'pr-ci', model: 'claude-sonnet-5-5', effort: 'low', why: 'watch CI' }
]
const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'w1', path: '/w', branch: 'b', displayName: 'Herrero · ORCA-7 Fix it' },
  agents: [],
  review: null,
  workItem: null,
  role: 'member'
}
const MIN = 60_000
const SUMMARY = { role: 'user', text: 'summary', toolUses: [] }

type Usage = Record<string, number | string>
type World = {
  plan?: unknown[]
  quota?: number
  sessionModel?: string
  /** The `model` setting as `settings.read` resolves it. */
  settingModel?: string
  /** The member's own command line, as `ps` prints it. */
  commandLine?: string
  /** What each step's response reports; null for none. */
  usage?: (requested: string) => Usage | null
  memory: Record<string, unknown>
}
type Seen = { model: string; effort: unknown }

// A main-loop request of `context` tokens written at `ttl`, answered by the model asked for.
const usageOf =
  (context: number, answered?: string, ttl: '5m' | '1h' = '1h') =>
  (requested: string): Usage => ({
    model: answered ?? requested,
    input_tokens: 2,
    output_tokens: 500,
    cache_read_input_tokens: context - 1_000,
    cache_creation_input_tokens: 998,
    ephemeral_1h_input_tokens: ttl === '1h' ? 998 : 0,
    ephemeral_5m_input_tokens: ttl === '5m' ? 998 : 0
  })

const answer = (stdout: unknown) => ({
  value: {
    exitCode: 0,
    stdout: JSON.stringify(stdout),
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false
  }
})

const start = async ($: Engine, on: On, world: World, seen: Seen[]) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_ROLE: 'member' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: world.sessionModel ?? 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { model: world.settingModel } }) as never)
  on('session.compact', () => ({ messages: [SUMMARY] }) as never)
  on('store.get', (_$, e) => ({ value: world.memory[e.key] }))
  on('store.set', (_$, e) => {
    world.memory[e.key] = e.value
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('turn.complete', () => ({ text: 'ok' }))
  on(
    'session.usage',
    () =>
      ({
        value: {
          startedAt: 0,
          context: {},
          rateLimits: [{ kind: 'five_hour', percentUsed: world.quota ?? 10 }]
        }
      }) as never
  )
  on('tool.call', () => ({ result: {}, text: '' }) as never)
  on(
    'model.complete',
    () => ({ value: { isAnswered: false, reason: 'aborted', usage: {} } }) as never
  )
  on('process.run', (_$, e) =>
    e.argv[0] === 'sh'
      ? { value: { ...answer(null).value, stdout: `${world.commandLine ?? 'claude'}\n` } }
      : e.argv.includes('plan')
        ? answer({
            id: 'p',
            ok: true,
            result: {
              ticket: 'ORCA-7',
              known: true,
              plan: { source: 'lead', kind: null, phases: world.plan ?? PLAN }
            }
          })
        : answer(STATE)
  )
  on('turn.step', async function* (_$, e) {
    yield* []
    seen.push({ model: e.model, effort: e.effort })
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: world.usage?.(e.model) ?? null
    } as never
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const step = async ($: Engine, index: number, over: Record<string, unknown> = {}) => {
  const stream = $.turn.step({
    turnId: 't1',
    index,
    messageCount: 40 + index,
    ...OPUS_HIGH,
    ...over
  } as never)
  for await (const _chunk of stream) {
    // drain
  }
  await stream.result
}

const push = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'gh pr checks 12' } as never)

type Decision = {
  moment: string
  applied: boolean
  to: Seen
  source: string
  cache?: Record<string, unknown>
  phaseTurns?: unknown
}
const decisionsOf = (world: World): Decision[] =>
  (Reflect.get(world.memory.steward as object, 's1') as { decisions: Decision[] }).decisions

const picks = (seen: Seen[]) => seen.map((one) => `${one.model}/${String(one.effort)}`)

describe('the steward and the prompt cache (ORCA-1350)', () => {
  test('warm cache: watching CI keeps Opus and only drops the effort', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000) }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await clock.settle()
    await push($)
    await clock.settle()
    await step($, 1)
    expect(picks(seen).at(-1)).toBe('claude-opus-5-5/low')
    expect(decisionsOf(world).at(-1)).toMatchObject({
      moment: 'pr-ci',
      to: { model: 'claude-opus-5-5', effort: 'low' },
      cache: {
        warm: true,
        known: true,
        ttl: '1h',
        contextTokens: 120_000,
        why: 'warm-hold',
        breakEven: 83
      }
    })
  })

  test('the held switch lands once the cache goes cold', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(500_000, undefined, '5m') }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await push($)
    await clock.settle()
    await step($, 1)
    for (let minute = 0; minute < 6; minute += 1) {
      await clock.advance(MIN)
    }
    await step($, 2)
    expect(picks(seen).slice(1)).toEqual(['claude-opus-5-5/low', 'claude-sonnet-5-5/low'])
    expect(decisionsOf(world).at(-1)).toMatchObject({
      moment: 'cold',
      applied: true,
      cache: { warm: false }
    })
  })

  test('a compaction is the switch point for a held switch', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000) }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await push($)
    await clock.settle()
    await step($, 1)
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY, SUMMARY] } as never)
    await step($, 2, { messageCount: 3 })
    expect(picks(seen).at(-1)).toBe('claude-sonnet-5-5/low')
    expect(decisionsOf(world).at(-1)).toMatchObject({ moment: 'compacted', applied: true })
  })

  test('a /rewind keeps the cache warm, so a held switch stays held', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000) }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await push($)
    await clock.settle()
    await step($, 1)
    await step($, 2, { messageCount: 3 })
    expect(picks(seen).at(-1)).toBe('claude-opus-5-5/low')
  })

  test('a usage window past 85 % switches down on a warm cache', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000), quota: 90 }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 1,
      isAborted: false,
      turnId: 't1'
    } as never)
    await clock.settle()
    await push($)
    await clock.settle()
    await step($, 1)
    expect(picks(seen).at(-1)).toBe('claude-sonnet-5-5/low')
    expect(decisionsOf(world).at(-1)).toMatchObject({ moment: 'pr-ci', cache: { why: 'quota' } })
  })

  test('a high-risk edit raises the model on a warm cache and records the miss', async ($, on) => {
    const seen: Seen[] = []
    const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
    const map = { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read' }
    const world: World = {
      memory: {},
      usage: usageOf(100_000),
      sessionModel: 'claude-sonnet-5-5',
      plan: [map, ...PLAN]
    }
    const clock = await start($, on, world, seen)
    await step($, 0, sonnet)
    await clock.settle()
    await $.tool.call({
      tool: 'Edit',
      file_path: '/w/auth/login.ts',
      old_string: 'a',
      new_string: 'b'
    } as never)
    await clock.settle()
    await step($, 1, sonnet)
    expect(picks(seen).at(-1)).toBe('claude-opus-5-5/xhigh')
    const raise = decisionsOf(world).at(-1)
    expect(raise).toMatchObject({ moment: 'high-risk', cache: { why: 'upward', breakEven: null } })
    expect(Math.round(Number(raise?.cache?.extraUsd) * 100)).toBe(79)
  })

  // Why a Sonnet session with Opus steps: 2.1.330 resolves opusplan to Sonnet even in plan mode (live).
  test('stands down under opusplan, whose plan-mode toggle is its own switch', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000), sessionModel: 'claude-sonnet-5-5' }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await push($)
    await clock.settle()
    await step($, 1)
    expect(picks(seen).at(-1)).toBe('claude-opus-5-5/high')
    expect(decisionsOf(world).find((one) => one.moment === 'stand-down')).toMatchObject({
      source: 'opusplan'
    })
  })

  test('stands down for the rest of a turn an automatic fallback answered', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000, 'claude-opus-4-8') }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await clock.settle()
    await push($)
    await clock.settle()
    await step($, 1)
    expect(picks(seen).at(-1)).toBe('claude-opus-5-5/high')
    expect(decisionsOf(world).find((one) => one.moment === 'stand-down')).toMatchObject({
      source: 'fallback'
    })
  })

  test('logs how many steps the phase it leaves really took', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { memory: {}, usage: usageOf(120_000) }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await $.tool.call({
      tool: 'Edit',
      file_path: '/w/src/a.ts',
      old_string: 'a',
      new_string: 'b'
    } as never)
    await clock.settle()
    for (const index of [1, 2, 3]) {
      await step($, index)
    }
    await push($)
    await clock.settle()
    expect(decisionsOf(world).at(-1)).toMatchObject({
      moment: 'pr-ci',
      phaseTurns: { phase: 'implement', turns: 3 }
    })
  })

  test("stands down when the model setting is opusplan, in execution's Sonnet steps too", async ($, on) => {
    const seen: Seen[] = []
    const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
    const world: World = {
      memory: {},
      usage: usageOf(120_000),
      sessionModel: 'claude-sonnet-5-5',
      settingModel: 'opusplan'
    }
    const clock = await start($, on, world, seen)
    await step($, 0, sonnet)
    await $.tool.call({
      tool: 'Edit',
      file_path: '/w/src/a.ts',
      old_string: 'a',
      new_string: 'b'
    } as never)
    await clock.settle()
    await step($, 1, sonnet)
    expect(picks(seen).at(-1)).toBe('claude-sonnet-5-5/medium')
  })

  test('one Opus skill step in a Sonnet session stands down for that step only', async ($, on) => {
    const seen: Seen[] = []
    const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
    const map = { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read' }
    const world: World = {
      memory: {},
      usage: usageOf(120_000),
      sessionModel: 'claude-sonnet-5-5',
      plan: [map, ...PLAN]
    }
    const clock = await start($, on, world, seen)
    await step($, 0, sonnet)
    await $.tool.call({
      tool: 'Edit',
      file_path: '/w/src/a.ts',
      old_string: 'a',
      new_string: 'b'
    } as never)
    await clock.settle()
    await step($, 1, { model: 'claude-opus-5-5', effort: 'high' })
    await step($, 0, { ...sonnet, turnId: 't2' })
    expect(picks(seen).slice(1)).toEqual(['claude-opus-5-5/high', 'claude-opus-5-5/high'])
    expect(decisionsOf(world).at(-1)).toMatchObject({ moment: 'stand-down', source: 'none' })
  })

  test('stands down when opusplan comes from the command line, which no setting shows', async ($, on) => {
    const seen: Seen[] = []
    const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
    const world: World = {
      memory: {},
      usage: usageOf(120_000),
      sessionModel: 'claude-sonnet-5-5',
      settingModel: 'opus',
      commandLine: 'claude --plugin-dir /p --model opusplan --effort medium'
    }
    const clock = await start($, on, world, seen)
    await step($, 0, sonnet)
    await $.tool.call({
      tool: 'Edit',
      file_path: '/w/src/a.ts',
      old_string: 'a',
      new_string: 'b'
    } as never)
    await clock.settle()
    await step($, 1, sonnet)
    expect(picks(seen).at(-1)).toBe('claude-sonnet-5-5/medium')
    expect(decisionsOf(world).find((one) => one.moment === 'stand-down')).toMatchObject({
      source: 'opusplan'
    })
  })

  test('logs a fallback in a Sonnet session as the fallback, not as opusplan', async ($, on) => {
    const seen: Seen[] = []
    const world: World = {
      memory: {},
      usage: usageOf(120_000, 'claude-haiku-5-5'),
      sessionModel: 'claude-sonnet-5-5',
      commandLine: 'claude --model sonnet'
    }
    const clock = await start($, on, world, seen)
    await step($, 0, { model: 'claude-sonnet-5-5', effort: 'medium' })
    await clock.settle()
    await step($, 1)
    const sources = decisionsOf(world)
      .filter((one) => one.moment === 'stand-down')
      .map((one) => one.source)
    expect(sources).toEqual(['fallback'])
  })

  test('stands down for --model opusplan[1m], the 1M-context form of the flag', async ($, on) => {
    const seen: Seen[] = []
    const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' }
    const world: World = {
      memory: {},
      usage: usageOf(120_000),
      sessionModel: 'claude-sonnet-5-5',
      settingModel: 'opus',
      commandLine: 'claude --model opusplan[1m] --effort medium'
    }
    const clock = await start($, on, world, seen)
    await step($, 0, sonnet)
    await $.tool.call({
      tool: 'Edit',
      file_path: '/w/src/a.ts',
      old_string: 'a',
      new_string: 'b'
    } as never)
    await clock.settle()
    await step($, 1, sonnet)
    expect(picks(seen).at(-1)).toBe('claude-sonnet-5-5/medium')
  })
})
