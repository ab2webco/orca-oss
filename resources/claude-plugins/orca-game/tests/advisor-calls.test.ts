// Runs under `claude plugin test`: Claude's own advisor calls, as the session appends their rows.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin, TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const VIEWPORT = { columns: 170, rows: 40, isFullscreen: true } as const
const BAND = {
  component: 'AbovePrompt',
  viewport: VIEWPORT,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const
const SPINNER = {
  component: 'Spinner',
  viewport: VIEWPORT,
  props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
} as const
const TURN = {
  reason: 'answer',
  answer: 'ok',
  durationMs: 1,
  isAborted: false,
  turnId: 't1'
} as const

// The blocks Claude Code 2.1.303 kept for one advisor call, 80 s apart; encrypted_content cut.
const ID = 'srvtoolu_019eMoTkm1NZbJoeEyN9H61U'
const CALL = { type: 'server_tool_use', id: ID, name: 'advisor', input: {} }
const RESULT = {
  type: 'advisor_tool_result',
  tool_use_id: ID,
  content: { type: 'advisor_redacted_result', encrypted_content: 'ErcfCioIFBgCIiRl' }
}
const WEB_SEARCH = { type: 'server_tool_use', id: 'srvtoolu_01Web', name: 'web_search', input: {} }

type Engine = Parameters<TestBody>[0]

const append = ($: Engine, block: Record<string, unknown> & { type: string }, agentId?: string) =>
  $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [block] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: `row-${String(block.type)}-${agentId ?? 'main'}`,
    ...(agentId === undefined ? {} : { agentId })
  })

const engine = (on: On, env: Record<string, string> = {}) => {
  mock.env(on, env)
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
}

const start = async ($: Engine, on: On, env: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  engine(on, env)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const sceneInBand = async ($: Engine) => {
  const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
  const raster = await band.find({ type: 'Raster', key: 'band-pet-scene' })
  await band.unmount()
  return raster
}

const spinnerCells = async ($: Engine) => {
  const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
  const raster = await spinner.find({ type: 'Raster' })
  await spinner.unmount()
  return raster?.props.cells
}

const advisorLine = (line: string) =>
  JSON.stringify({
    version: 1,
    locale: 'es',
    line,
    model: 'Opus 5.5',
    modelId: 'claude-opus-5-5',
    effort: 'high',
    subagents: [],
    ci: [],
    notices: []
  })

const JEV: Plugin = {
  name: 'orca-jev-mod-skills',
  register(on) {
    on('session.start', async ($, e, next) => {
      const raw = await $.env.get('TEST_ADVISOR')
      if (raw !== undefined && raw !== null && raw !== '') {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      return next(e)
    })
  }
}

describe('Claude’s advisor calls', () => {
  test('without Jev, the advisor arrives for the call, thinks until its result, reacts, then leaves', async ($, on) => {
    const clock = await start($, on)
    expect(await sceneInBand($)).toBeUndefined()
    await append($, CALL)
    expect(await sceneInBand($)).toBeDefined()
    // A real call runs 80 to 210 s, far past any one gesture.
    await clock.advance(90_000)
    expect(await sceneInBand($)).toBeDefined()
    await append($, RESULT)
    expect(await sceneInBand($)).toBeDefined()
    await clock.advance(10_000)
    expect(await sceneInBand($)).toBeUndefined()
  })

  test('another server tool, or a subagent’s advisor call, brings nothing', async ($, on) => {
    await start($, on)
    await append($, WEB_SEARCH)
    await append($, CALL, 'agent-1')
    expect(await sceneInBand($)).toBeUndefined()
    await append($, CALL)
    expect(await sceneInBand($)).toBeDefined()
  })

  test('a call whose result never comes ends with the turn', async ($, on) => {
    const clock = await start($, on)
    await append($, CALL)
    await clock.advance(90_000)
    expect(await sceneInBand($)).toBeDefined()
    await $.turn.complete(TURN)
    await clock.settle()
    expect(await sceneInBand($)).toBeUndefined()
  })

  // Why twice before: the same tick draws the same cells, so a change after the row is the call's.
  const drawsTheCall = async ($: Engine) => {
    const before = await spinnerCells($)
    expect(before).toBeDefined()
    expect(await spinnerCells($)).toBe(before)
    await append($, CALL)
    expect(await spinnerCells($)).not.toBe(before)
  }

  for (const render of ['classic', 'hd']) {
    test(`draws in the ${render} scene without Jev`, async ($, on) => {
      await start($, on, { ORCA_GAME_RENDER: render })
      await drawsTheCall($)
    })

    test(
      `draws in the ${render} scene while the game leaves Jev its own band`,
      { plugins: [JEV] },
      async ($, on) => {
        const env = { ORCA_GAME_RENDER: render, ORCA_GAME_HUD: '0' }
        await start($, on, { ...env, TEST_ADVISOR: advisorLine('jev · agentes') })
        await drawsTheCall($)
      }
    )
  }

  for (const line of ['jev · agentes', 'clef · herramienta: Bash (aplicada)']) {
    const judge = line.split(' ')[0] ?? ''
    test(`plays on Jev’s advisor when ${judge} judges`, { plugins: [JEV] }, async ($, on) => {
      await start($, on, { TEST_ADVISOR: advisorLine(line) })
      expect(await sceneInBand($)).toBeUndefined()
      await append($, CALL)
      expect(await sceneInBand($)).toBeDefined()
    })

    test(
      `draws the call on Jev’s advisor when ${judge} judges`,
      { plugins: [JEV] },
      async ($, on) => {
        await start($, on, { TEST_ADVISOR: advisorLine(line) })
        await drawsTheCall($)
      }
    )
  }
})
