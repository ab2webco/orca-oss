// Runs under `claude plugin test`: a project scene switched in Settings reaches an open band, spinner and Panel on the next poll.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUEST_SCENE } from '../hooks/scenes/quest'
import { VIGILANTE_SCENE } from '../hooks/scenes/vigilante'
import type { SceneDefinition } from '../hooks/scenes/index'

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
const POLL_MS = 30000
const FILE_ID = 'file:.orca/scenes/mario-bros.json'
const RED = 0xe52521
// Why near red: hd lights every colour by the hour, so the exact value never reaches the Raster.
const isReddish = (rgb: number) => (rgb >> 16) - Math.max((rgb >> 8) & 255, rgb & 255) > 0x60
const MARIO: SceneDefinition = {
  ...QUEST_SCENE,
  id: FILE_ID,
  looks: Object.fromEntries(
    Object.entries(QUEST_SCENE.looks).map(([phase, look]) => [
      phase,
      { ...look, skyTop: RED, skyBottom: RED, far: RED, near: RED, ground: RED }
    ])
  ) as SceneDefinition['looks'],
  cards: Object.fromEntries(
    Object.entries(QUEST_SCENE.cards).map(([phase, card]) => [
      phase,
      { ...card, name: { en: 'Yoshi', es: 'Yoshi' } }
    ])
  ) as SceneDefinition['cards'],
  band: { ...QUEST_SCENE.band, gold: '#e52521' }
}

type Served = 'file' | 'built-in'

const stateOf = (served: Served, render: string) =>
  JSON.stringify({
    id: 'x',
    ok: true,
    result: {
      config: { scene: served === 'file' ? FILE_ID : VIGILANTE_SCENE.id, render, timezone: 'UTC' },
      sources: { scene: 'project' },
      warnings: [],
      worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
      agents: [
        {
          paneKey: 'tab-1:lead',
          displayName: 'lead',
          agentType: 'claude',
          state: 'working',
          toolName: 'Edit',
          isLeader: true
        }
      ],
      review: null,
      workItem: null,
      extensions: {
        scenes: served === 'file' ? [{ id: FILE_ID, pluginId: 'file', definition: MARIO }] : []
      }
    }
  })

const engine = (on: On, world: { stdout: string }) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    const isGame = e.argv.join(' ') === [ORCA_CLI, 'game', 'state', '--json'].join(' ')
    return {
      value: {
        exitCode: isGame ? 0 : 1,
        stdout: isGame ? world.stdout : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

type Dollar = Parameters<TestBody>[0]

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Every colour a Raster's half-block cells paint. */
const pixelsOf = (encoded: string): Set<number> => {
  const bytes: number[] = []
  for (let i = 0; i + 3 < encoded.length; i += 4) {
    const word = Array.from(encoded.slice(i, i + 4), (one) =>
      one === '=' ? 0 : BASE64.indexOf(one)
    )
    const n =
      ((word[0] ?? 0) << 18) | ((word[1] ?? 0) << 12) | ((word[2] ?? 0) << 6) | (word[3] ?? 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const words: number[] = []
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) |
        ((bytes[i + 1] ?? 0) << 8) |
        ((bytes[i + 2] ?? 0) << 16) |
        ((bytes[i + 3] ?? 0) << 24)) >>>
        0
    )
  }
  const pixels = new Set<number>()
  for (let i = 0; i + 2 < words.length; i += 3) {
    if (words[i] === 0x2580) {
      pixels.add(words[i + 1] ?? 0)
      pixels.add(words[i + 2] ?? 0)
    }
  }
  return pixels
}

/** What each surface shows: the band's Panel chip colour, the spinner painting red, the Panel's cards. */
const shownOf = async ($: Dollar) => {
  const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
  const chip = await band.find({ type: 'Text', text: / ▤ Panel / })
  await band.unmount()
  const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
  const raster = await spinner.find({ type: 'Raster' })
  await spinner.unmount()
  const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
  const yoshi = await pane.find({ type: 'Text', text: /Yoshi/ })
  const nightWatch = await pane.find({
    type: 'Text',
    text: /Night Watch|Detective|Gadgeteer|Mentor|Rooftop Run|Commissioner/
  })
  await pane.unmount()
  return {
    chip: chip?.props.backgroundColor,
    isRed: [...pixelsOf(String(raster?.props.cells ?? ''))].some(isReddish),
    cards: yoshi !== undefined ? 'file' : nightWatch !== undefined ? 'built-in' : 'none'
  }
}

const FILE_SHOWN = { chip: '#e52521', isRed: true, cards: 'file' }
const BUILT_IN_SHOWN = { chip: VIGILANTE_SCENE.band.gold, isRed: false, cards: 'built-in' }

describe('a project scene switched in Settings', () => {
  for (const render of ['classic', 'hd']) {
    test(`redraws the ${render} band, spinner and Panel on the next poll, sceneFile to built-in and back`, async ($, on) => {
      const world = { stdout: stateOf('file', render) }
      const clock = mock.clock(on, { now: Date.UTC(2026, 9, 21, 12) })
      engine(on, world)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      expect(await shownOf($)).toEqual(FILE_SHOWN)
      world.stdout = stateOf('built-in', render)
      await clock.advance(POLL_MS)
      expect(await shownOf($)).toEqual(BUILT_IN_SHOWN)
      world.stdout = stateOf('file', render)
      await clock.advance(POLL_MS)
      expect(await shownOf($)).toEqual(FILE_SHOWN)
    })
  }
})
