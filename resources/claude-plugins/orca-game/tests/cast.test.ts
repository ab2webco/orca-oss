// Runs under `claude plugin test`: the scene's pet in the band and the Panel.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUEST_SCENE } from '../hooks/scenes/quest'

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
const PANE = {
  component: 'Pane',
  requestId: 'orca-game-fleet',
  viewport: VIEWPORT,
  props: {
    title: 'Fleet',
    isFocused: true,
    bodyColumns: 140,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {}
  }
} as const
const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json']

const WOLF = {
  name: { en: 'Wolf', es: 'Lobo' },
  frames: [['W...W', 'WWWWW', 'WEWEW', '.WWW.', '.W.W.']],
  happy: ['W...W', 'WWWWW', 'WHWHW', '.WWW.', '.W.W.'],
  colors: { W: 0xd8d8d8, E: 0x1a1a1a, H: 0xff5a8a }
}

const stateWith = (cast: unknown) => ({
  config: { scene: 'file:.orca/scenes/mc.json' },
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    {
      paneKey: 'tab-1:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  links: [],
  extensions: {
    scenes: [
      {
        id: 'file:.orca/scenes/mc.json',
        pluginId: 'file',
        definition: { ...QUEST_SCENE, id: 'file:.orca/scenes/mc.json', cast }
      }
    ]
  }
})

const engine = (on: On, env: Record<string, string>, cast: unknown) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    const isGame = e.argv.join(' ') === GAME_STATE.join(' ')
    return {
      value: {
        exitCode: isGame ? 0 : 1,
        stdout: isGame ? JSON.stringify(stateWith(cast)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

describe('the scene pet', () => {
  test('Pet names the scene pet in the band and the Panel, in the session language', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_LOCALE: 'es' }, { pet: WOLF })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await band.find({ type: 'Text', text: / ♥ Mimar a Lobo / })).toBeDefined()
    expect(await band.find({ type: 'Raster', key: 'band-pet-scene' })).toBeUndefined()
    await band.press({ key: 'band-pet' })
    expect(await band.find({ type: 'Raster', key: 'band-pet-scene' })).toBeDefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: / ♥ Mimar a Lobo / })).toBeDefined()
    await pane.unmount()
  })

  test('a scene without a pet keeps a plain Pet for Clawd', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, {}, undefined)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await band.find({ type: 'Text', text: /^ ♥ Pet $/ })).toBeDefined()
    await band.unmount()
  })
})
