#!/usr/bin/env node
// Renders the game mod's scene grids (the cells its Raster receives) to PNGs, so a render can be looked at.
// These are cell-grid renders in a browser, not terminal screenshots: a terminal's font and gamma differ.
// Usage: node config/scripts/orca-game-scene-captures.mjs [--out <dir>] [--scene-file <json>] [--phases <all|a,b>]
//   [--gesture <advisor gesture>] [--columns <a,b>]
// A scene file is drawn in every phase and the built-ins in build, unless --phases says otherwise.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { captureOptionsOf, scenePhasesOf, sceneShotsOf } from './orca-game-scene-capture-plan.mjs'

const root = resolve(import.meta.dirname, '../..')
const mod = join(root, 'resources/claude-plugins/orca-game/hooks')
const { out, sceneFile, phases, gesture, columns } = captureOptionsOf(process.argv.slice(2), root)

const ENTRY = `
import { sceneGridOf } from './scene'
import { hdSceneGridOf } from './scene-hd'
import { daylightAt } from './hd-daylight'
import { advisorSpriteOf } from './advisor-art'
import { SCENES } from './scenes/index'
import { advisorCardOf } from './advisor-card-rows'
import { advisorTileGridOf } from './advisor-tile'
import { advisorOf } from './allies'
import { TILE_COLUMNS, tileGridOf } from './fleet-tiles'
import { gameStrings, setGameLocale } from './game-strings'
import { memberAdvisorLinesOf } from './member-advisor'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'
export const SCENE_IDS = Object.keys(SCENES)
export const sceneOfFile = (text) => {
  const parsed = parseOrchestratorGameScene(text, 'file:.orca/scenes/capture.json')
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.definition
}
const PARTY = [
  { key: 'a', phase: 'verify', state: 'working' },
  { key: 'b', phase: 'docs', state: 'waiting' }
]
const BUBBLES = { approved: 'kept Opus', stopped: 'clef · rm -rf build' }
export const gridOf = ({ scene, phase, render, columns, tick, hour, caption, gesture }) => {
  const definition = typeof scene === 'string' ? SCENES[scene] : scene
  const advisor = { sprite: advisorSpriteOf(definition), gesture, age: 30, bubble: BUBBLES[gesture] ?? gesture }
  return render === 'hd'
    ? hdSceneGridOf({ scene: definition, phase, columns, rows: 9, tick, caption, since: 0,
        action: 'edit', light: daylightAt(hour), party: PARTY, lead: 'Lead', advisor })
    : sceneGridOf(definition, phase, columns, tick, caption, 0, undefined, false, 'edit', advisor)
}
const JEV = { version: 1, locale: 'es', line: 'jev · 2 agentes', model: 'glm-5.3', modelId: 'glm-5.3',
  effort: 'high', subagents: [], ci: [], notices: [] }
const LOG = [
  { key: 'a1', title: 'Fix CI', model: 'Opus 5.5', effort: 'high', verdict: 'igual', gesture: 'approved', at: 1 },
  { key: 'a2', title: 'Write docs', model: 'Haiku 4.5', effort: null, verdict: 'Haiku basta', gesture: 'lowered', at: 2 }
]
// The Panel's advisor card under a member card, as the pane stacks them.
export const cardsOf = ({ scene, isLogged }) => {
  setGameLocale('es')
  const definition = typeof scene === 'string' ? SCENES[scene] : scene
  const sprite = advisorSpriteOf(definition)
  const card = advisorCardOf(sprite, advisorOf(JEV), isLogged ? LOG : [])
  return { card, tileColumns: TILE_COLUMNS, palette: definition.band,
    tile: advisorTileGridOf(sprite, card.pose, 0), member: tileGridOf(definition, 'working', 'working', 0),
    empty: gameStrings().text.advisorEmpty }
}
const MEMBER_JEV = { model: 'Sonnet 5.5', effort: 'high', pinned: { model: true, effort: false },
  previous: { model: 'Opus 5.5', effort: 'high' } }
// A member card of the lead's Panel, with the row its own Jev reports or without one.
export const memberCardOf = ({ scene, withJev, columns }) => {
  setGameLocale('es')
  const definition = typeof scene === 'string' ? SCENES[scene] : scene
  const jev = withJev ? memberAdvisorLinesOf(MEMBER_JEV, columns - TILE_COLUMNS - 3) : []
  return { tileColumns: TILE_COLUMNS, tile: tileGridOf(definition, 'working', 'working', 0),
    lines: [[['CIN-5', 'cyan'], ['trabajando', 'cyan']], ...jev.map((line) => [[line, definition.band.gold]]),
      [['editando fleet-pane.tsx', '#dddddd']]] }
}
`

const hex = (color) => `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`

const htmlOf = (grid, columns) => {
  const cells = grid
    .map(([glyph, fg, bg]) =>
      glyph === 0x2580
        ? `<i style="background:linear-gradient(${hex(fg)} 50%,${hex(bg)} 50%)"></i>`
        : `<i style="color:${hex(fg)};background:${hex(bg)}">${String.fromCodePoint(glyph)
            .replace('&', '&amp;')
            .replace('<', '&lt;')}</i>`
    )
    .join('')
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111}
#g{display:grid;grid-template-columns:repeat(${columns},9px);width:max-content}
i{display:block;width:9px;height:18px;font:15px/18px Menlo,Consolas,'DejaVu Sans Mono',monospace;
font-style:normal;text-align:center;overflow:hidden}
</style><div id="g">${cells}</div>`
}

const TERMINAL = 0x111111
const NAMED = { green: 0x5fd75f, yellow: 0xffd75f, red: 0xff5f5f, cyan: 0x5fd7d7, dim: 0x808080 }
const colorOf = (name) => NAMED[name] ?? Number.parseInt(name.slice(1), 16)
const GESTURE_COLORS = { lowered: 'green', raised: 'yellow', unsure: 'yellow', escalated: 'red' }

// Approximates the card's Ink layout: round border, the tile, then text cut to the room left.
const cardGridOf = (columns, tile, tileColumns, lines, border) => {
  const room = columns - tileColumns - 3
  const tileRows = tile.length / tileColumns
  const rows = Math.max(tileRows, lines.length)
  const grid = []
  const put = (glyph, fg) => grid.push([glyph.codePointAt(0), fg, TERMINAL])
  const edge = (left, right) => {
    put(left, border)
    for (let x = 1; x < columns - 1; x += 1) {
      put('─', border)
    }
    put(right, border)
  }
  edge('╭', '╮')
  for (let row = 0; row < rows; row += 1) {
    put('│', border)
    for (let x = 0; x < tileColumns; x += 1) {
      grid.push(row < tileRows ? tile[row * tileColumns + x] : [0x20, TERMINAL, TERMINAL])
    }
    put(' ', TERMINAL)
    const glyphs = (lines[row] ?? []).flatMap(([text, color], index) =>
      [...(index === 0 ? text : ` ${text}`)].map((glyph) => [glyph, colorOf(color)])
    )
    const shown =
      glyphs.length > room ? [...glyphs.slice(0, room - 1), ['…', glyphs[room - 1][1]]] : glyphs
    for (let x = 0; x < room; x += 1) {
      put(shown[x]?.[0] ?? ' ', shown[x]?.[1] ?? TERMINAL)
    }
    put('│', border)
  }
  edge('╰', '╯')
  return grid
}

const cardsGridOf = (columns, { card, tile, member, tileColumns, palette, empty }) => {
  const header = [
    [`◆ ${card.name}`, palette.gold],
    [card.badge, palette.parchment],
    [card.line ?? '', 'dim']
  ]
  const rows =
    card.rows.length === 0
      ? [[[empty, 'dim']]]
      : card.rows.map((row) => [[row.text, GESTURE_COLORS[row.gesture] ?? palette.parchment]])
  const memberLines = [
    [
      ['lead', 'cyan'],
      ['working', 'cyan']
    ],
    [['editing scene-hd.ts', '#dddddd']]
  ]
  return [
    ...cardGridOf(columns, member, tileColumns, memberLines, colorOf('cyan')),
    ...cardGridOf(
      columns,
      tile,
      tileColumns,
      [header.filter(([text]) => text !== ''), ...rows],
      colorOf(palette.gold)
    )
  ]
}

const main = async () => {
  await mkdir(out, { recursive: true })
  const bundle = join(out, 'scene-entry.mjs')
  await build({
    stdin: { contents: ENTRY, resolveDir: mod, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundle,
    logLevel: 'warning'
  })
  const { SCENE_IDS, gridOf, cardsOf, memberCardOf, sceneOfFile } = await import(
    pathToFileURL(bundle).href
  )
  const custom = sceneFile === undefined ? [] : [sceneOfFile(await readFile(sceneFile, 'utf8'))]
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const shots = []
  const shoot = async (name, grid, columns) => {
    await page.setContent(htmlOf(grid, columns))
    const path = join(out, `${name}.png`)
    await page.locator('#g').screenshot({ path })
    shots.push(path)
  }
  // A sheet of labelled captures, so a whole phase of a scene is looked at in one image.
  const sheetOf = async (id, names) => {
    const panels = await Promise.all(
      names.map(async (name) => {
        const data = (await readFile(join(out, `${name}.png`))).toString('base64')
        return `<p>${name}</p><img src="data:image/png;base64,${data}">`
      })
    )
    await page.setContent(
      `<!doctype html><style>body{margin:8px;background:#222;color:#ddd;font:13px Menlo,monospace}
p{margin:10px 0 4px}img{display:block}</style><div id="s">${panels.join('')}</div>`
    )
    const path = join(out, `sheet-${id}.png`)
    await page.locator('#s').screenshot({ path })
    shots.push(path)
  }
  for (const scene of [...SCENE_IDS, ...custom]) {
    const id = typeof scene === 'string' ? scene : 'scene-file'
    // One sheet per phase: six captures stay readable, thirty-six in one image do not.
    for (const phase of scenePhasesOf(phases, typeof scene !== 'string')) {
      const before = shots.length
      for (const shot of sceneShotsOf(id, [phase], columns)) {
        const caption = 'Editing scene-hd.ts'
        await shoot(shot.name, gridOf({ scene, ...shot, tick: 41, caption, gesture }), shot.columns)
      }
      const names = shots.slice(before).map((path) => path.slice(out.length + 1, -'.png'.length))
      await sheetOf(`${id}-${phase}`, names)
    }
  }
  const cardShots = shots.length
  for (const scene of [...SCENE_IDS, ...custom]) {
    const id = typeof scene === 'string' ? scene : 'scene-file'
    for (const columns of [60, 40]) {
      for (const isLogged of [true, false]) {
        const grid = cardsGridOf(columns, cardsOf({ scene, isLogged }))
        await shoot(`card-${id}-${isLogged ? 'logged' : 'empty'}-${columns}`, grid, columns)
      }
    }
  }
  await sheetOf(
    'cards',
    shots.slice(cardShots).map((path) => path.slice(out.length + 1, -'.png'.length))
  )
  const memberShots = shots.length
  for (const scene of [...SCENE_IDS, ...custom]) {
    const id = typeof scene === 'string' ? scene : 'scene-file'
    for (const columns of [60, 40]) {
      for (const withJev of [true, false]) {
        const card = memberCardOf({ scene, withJev, columns })
        const grid = cardGridOf(columns, card.tile, card.tileColumns, card.lines, colorOf('cyan'))
        await shoot(`member-${id}-${withJev ? 'jev' : 'no-jev'}-${columns}`, grid, columns)
      }
    }
  }
  await sheetOf(
    'members',
    shots.slice(memberShots).map((path) => path.slice(out.length + 1, -'.png'.length))
  )
  await browser.close()
  await rm(bundle)
  await writeFile(join(out, 'index.txt'), `${shots.join('\n')}\n`)
  process.stdout.write(`${shots.length} captures in ${out}\n`)
}

await main()
