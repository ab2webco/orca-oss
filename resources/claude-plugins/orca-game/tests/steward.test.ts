// Runs under `claude plugin test`: the Orca steward picks a member's main-loop model and effort (ORCA-1242).
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

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
const PLAN = [
  {
    phase: 'map',
    model: 'claude-sonnet-5-5',
    effort: 'low',
    why: 'read first'
  },
  {
    phase: 'implement',
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    why: 'risky path'
  }
]
const LAUNCHED = { model: 'claude-sonnet-5-5', effort: 'medium' } as const

type World = {
  env?: Record<string, string>
  plan?: unknown[] | null
  haiku?: unknown
  quota?: number
  stores?: unknown[]
  /** Set for a store that keeps what the steward writes, and the env each state poll ran with. */
  memory?: Record<string, unknown>
  polls?: (Record<string, string> | undefined)[]
  highRiskPaths?: string[]
  /** Set to record each `$.env.set` the mods make. */
  sets?: { name: string; value?: string }[]
}
type Seen = { model: string; effort: unknown; agentId?: string }

// Publishes TEST_ADVISOR and TEST_ROUTER at start, as Jev does (a fake plugin cannot close over values).
const JEV: Plugin = {
  name: 'orca-jev-mod-skills',
  register(on) {
    on('session.start', async ($, e, next) => {
      const raw = await $.env.get('TEST_ADVISOR')
      if (raw !== undefined && raw !== null && raw !== '') {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      const router = await $.env.get('TEST_ROUTER')
      if (router !== undefined && router !== null && router !== '') {
        await $.state.set(
          { plugin: 'orca-jev-mod-skills', key: 'routerSticky' },
          JSON.parse(router)
        )
      }
      return next(e)
    })
  }
}
const WITH_JEV = { plugins: [JEV] }
const jevAdvisor = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    version: 1,
    line: 'jev',
    model: 'Sonnet 5.5',
    effort: 'medium',
    subagents: [],
    ci: [],
    notices: [],
    ...extra
  })

// Jev's router state; `rewrite` is true only in active mode once it picked another model or effort.
const jevRouter = (rewrite: boolean): string =>
  JSON.stringify({
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    rewrite,
    configuredModel: 'claude-sonnet-5-5',
    configuredEffort: 'medium'
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
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_ROLE: 'member', ...world.env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.set', (_$, e) => {
    world.sets?.push({ name: e.name, ...(e.value === undefined ? {} : { value: e.value }) })
    return { value: {} }
  })
  on('store.get', (_$, e) => ({ value: world.memory?.[e.key] }))
  on('store.set', (_$, e) => {
    world.stores?.push(e.key === 'steward' ? e.value : undefined)
    if (world.memory) {
      world.memory[e.key] = e.value
    }
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
  on('tool.call', (_$, e) =>
    (Reflect.get(e, 'command') as string | undefined)?.includes('fail')
      ? ({ isError: true, result: 'Exit code 1', text: 'Exit code 1' } as never)
      : ({ result: {}, text: '' } as never)
  )
  on(
    'model.complete',
    () => ({ value: world.haiku ?? { isAnswered: false, reason: 'aborted', usage: {} } }) as never
  )
  on('process.run', (_$, e) => {
    if (e.argv.includes('state')) {
      world.polls?.push(e.init?.env)
    }
    return e.argv.includes('plan')
      ? answer({
          id: 'p',
          ok: true,
          result: {
            ticket: 'ORCA-7',
            known: true,
            plan: world.plan ? { source: 'lead', kind: null, phases: world.plan } : null,
            ...(world.highRiskPaths ? { highRiskPaths: world.highRiskPaths } : {})
          }
        })
      : answer(STATE)
  })
  on('turn.step', async function* (_$, e) {
    yield* []
    seen.push({ model: e.model, effort: e.effort, ...(e.agentId ? { agentId: e.agentId } : {}) })
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: null
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const step = async ($: Engine, index: number, over: Record<string, unknown> = {}) => {
  const stream = $.turn.step({
    turnId: 't1',
    index,
    messageCount: 1,
    ...LAUNCHED,
    ...over
  } as never)
  for await (const _chunk of stream) {
    // drain
  }
  await stream.result
}

const edit = ($: Engine) =>
  $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' } as never)

describe('the Orca steward', () => {
  test("follows the lead's plan, and an edit raises the member to Opus from the next step", async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN }, seen)
    await step($, 0)
    await clock.settle()
    await step($, 1)
    await edit($)
    await clock.settle()
    await step($, 2)
    expect(seen.map((one) => `${one.model}/${String(one.effort)}`)).toEqual([
      'claude-sonnet-5-5/medium',
      'claude-sonnet-5-5/low',
      'claude-opus-5-5/xhigh'
    ])
  })

  test('acts when Jev is installed but its router rewrites nothing', WITH_JEV, async ($, on) => {
    const seen: Seen[] = []
    // Why routedModel too: Jev reports it in measure mode as well, where it changes nothing.
    const env = {
      TEST_ADVISOR: jevAdvisor({ routedModel: 'claude-sonnet-5-5' }),
      TEST_ROUTER: jevRouter(false)
    }
    const clock = await start($, on, { plan: PLAN, env }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)?.model).toBe('claude-opus-5-5')
  })

  test("stands down while Jev's router rewrites this member's steps", WITH_JEV, async ($, on) => {
    const seen: Seen[] = []
    const env = { TEST_ADVISOR: jevAdvisor({}), TEST_ROUTER: jevRouter(true) }
    const stores: unknown[] = []
    const clock = await start($, on, { plan: PLAN, env, stores }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
    // Why: the log must not claim a raise Jev's router overrode.
    const record = Reflect.get(stores.findLast(Boolean) as object, 's1') as {
      standDown: unknown
      decisions: { moment: string; applied: boolean }[]
    }
    expect(record.standDown).toBe('router')
    expect(record.decisions.find((one) => one.moment === 'edit')?.applied).toBe(false)
  })

  test('stands down on a step that already names another model', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1, { model: 'claude-fable-5-2' })
    expect(seen.at(-1)?.model).toBe('claude-fable-5-2')
  })

  test('keeps a model Orca pinned at launch and still moves the effort', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN, env: { ORCA_AGENT_MODEL_PINNED: '1' } }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
  })

  test('never touches a subagent step or a pane that is not a member', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1, { agentId: 'sub-1' })
    expect(seen.at(-1)).toEqual({ ...LAUNCHED, agentId: 'sub-1' })
  })

  test('a lead pane is never steered', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN, env: { ORCA_GAME_ROLE: 'lead' } }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual(LAUNCHED)
  })

  test('without a plan Haiku judges, and a sure answer moves the member on its effort', async ($, on) => {
    const seen: Seen[] = []
    const haiku = {
      isAnswered: true,
      text: '{"kind":"read","confidence":0.9,"why":"audit only"}',
      usage: { input_tokens: 900, output_tokens: 20 }
    }
    const clock = await start($, on, { plan: null, haiku }, seen)
    await step($, 0, { model: 'claude-opus-5-5', effort: 'high' })
    await clock.settle()
    await step($, 1, { model: 'claude-opus-5-5', effort: 'high' })
    // Why Opus stays (ORCA-1350): an unread cache counts as warm, so only the effort moves.
    expect(seen.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  test('Haiku slow or failing keeps the current model, silently', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: null }, seen)
    await step($, 0)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual(LAUNCHED)
  })

  test('the same test failing twice raises the effort to test-fix on Opus', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN }, seen)
    await step($, 0)
    await clock.settle()
    for (let i = 0; i < 2; i += 1) {
      await $.tool.call({ tool: 'Bash', command: 'pnpm vitest run fail.test.ts' } as never)
    }
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  test('a review that never edits stays on Opus: its plan starts in design', async ($, on) => {
    const seen: Seen[] = []
    const review = [
      { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read the diff' },
      { phase: 'design', model: 'claude-opus-5-5', effort: 'high', why: 'judge it' }
    ]
    const opus = { model: 'claude-opus-5-5', effort: 'high' }
    const clock = await start($, on, { plan: review }, seen)
    await step($, 0, opus)
    await clock.settle()
    await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' } as never)
    await step($, 1, opus)
    expect(seen.at(-1)).toEqual(opus)
  })

  test('past 85 % of a usage window the effort drops one level, the model stays', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN, quota: 90 }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 1,
      isAborted: false,
      turnId: 't1'
    } as never)
    await clock.settle()
    await step($, 2)
    expect(seen.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })

  test('a push after editing lowers the effort, never the model the next edit runs on', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN }, seen)
    await step($, 0)
    await edit($)
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin x' } as never)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
  })
})

describe("the steward's report to Orca (ORCA-1242)", () => {
  test('rides the state poll with its pick, plan, ticket and the edit decision', async ($, on) => {
    const seen: Seen[] = []
    const world: World = { plan: PLAN, memory: {}, polls: [] }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await clock.settle()
    await step($, 1)
    await edit($)
    await clock.settle()
    await $.turn.complete({
      reason: 'answer',
      answer: 'ok',
      durationMs: 1,
      isAborted: false,
      turnId: 't1'
    })
    await clock.settle()
    const raw = world.polls?.findLast((env) => env?.ORCA_GAME_STEWARD)?.ORCA_GAME_STEWARD
    const report = JSON.parse(raw ?? 'null') as Record<string, unknown> & {
      decisions: { moment: string; applied: boolean }[]
    }
    expect(report).toMatchObject({
      version: 1,
      session: 's1',
      ticket: 'ORCA-7',
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      phase: 'implement',
      plan: 'plan',
      standDown: null,
      pinned: { model: false, effort: false }
    })
    expect(report.decisions.map((one) => `${one.moment}:${String(one.applied)}`)).toEqual([
      'plan:true',
      'edit:true'
    ])
  })

  // Why: a claude started inside the pane inherits ORCA_GAME_ROLE=member and the mark (ORCA-1351).
  test("a claude started inside a member's pane is never steered and keeps no record", async ($, on) => {
    const seen: Seen[] = []
    const env = { ORCA_GAME_PANE_SESSION: 'member-session' }
    const world: World = { plan: PLAN, env, memory: {}, stores: [], polls: [] }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.map((one) => one.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5'])
    expect(world.stores?.some(Boolean)).toBe(false)
    expect(world.polls?.some((one) => one?.ORCA_GAME_STEWARD)).toBe(false)
  })

  test("the member's own session marks the pane for the claudes it starts", async ($, on) => {
    const world: World = { plan: PLAN, sets: [] }
    await start($, on, world, [])
    await step($, 0)
    expect(world.sets).toContainEqual({ name: 'ORCA_GAME_PANE_SESSION', value: 's1' })
  })

  test('a pane its own session already marked, as after a reload, is still steered', async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN, env: { ORCA_GAME_PANE_SESSION: 's1' } }, seen)
    await step($, 0)
    await edit($)
    await clock.settle()
    await step($, 1)
    expect(seen.at(-1)?.model).toBe('claude-opus-5-5')
  })

  test('a lead pane sends no steward report', async ($, on) => {
    const world: World = { env: { ORCA_GAME_ROLE: 'lead' }, memory: {}, polls: [] }
    const clock = await start($, on, world, [])
    await step($, 0)
    await clock.settle()
    expect(world.polls?.length).toBeGreaterThan(0)
    expect(world.polls?.some((env) => env?.ORCA_GAME_STEWARD)).toBe(false)
  })
})

describe('the key moments PR 3c adds (ORCA-1242)', () => {
  const HIGH = PLAN.map((one) => (one.phase === 'implement' ? { ...one, effort: 'high' } : one))
  const editAt = ($: Engine, path: string) =>
    $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
  const picks = (seen: Seen[]) => seen.map((one) => `${one.model}/${String(one.effort)}`)

  test("an approved plan moves the member to the lead's implement phase before any edit", async ($, on) => {
    const seen: Seen[] = []
    const clock = await start($, on, { plan: PLAN }, seen)
    await step($, 0)
    await clock.settle()
    await step($, 1)
    await $.tool.call({ tool: 'ExitPlanMode', plan: 'do it' } as never)
    await clock.settle()
    await step($, 2)
    expect(picks(seen)).toEqual([
      'claude-sonnet-5-5/medium',
      'claude-sonnet-5-5/low',
      'claude-opus-5-5/xhigh'
    ])
  })

  test("the first edit of an orca.yaml high-risk path runs at xhigh over the plan's high", async ($, on) => {
    const seen: Seen[] = []
    const world = { plan: HIGH, highRiskPaths: ['src/main/runtime/'] }
    const clock = await start($, on, world, seen)
    await step($, 0)
    await clock.settle()
    await editAt($, '/w/src/a.ts')
    await clock.settle()
    await step($, 1)
    await editAt($, '/w/src/main/runtime/b.ts')
    await clock.settle()
    await step($, 2)
    expect(picks(seen).slice(1)).toEqual(['claude-opus-5-5/high', 'claude-opus-5-5/xhigh'])
  })
})
