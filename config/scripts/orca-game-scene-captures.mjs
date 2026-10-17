#!/usr/bin/env node
// Renders the game mod's scene grids (the cells its Raster receives) to PNGs, so a render can be looked at.
// These are cell-grid renders in a browser, not terminal screenshots: a terminal's font and gamma differ.
// Usage: node config/scripts/orca-game-scene-captures.mjs [--out <dir>] [--scene-file <json>]
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../..')
const mod = join(root, 'resources/claude-plugins/orca-game/hooks')
const argOf = (name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}
const out = resolve(argOf('--out') ?? join(root, 'out/orca-game-captures'))
const sceneFile = argOf('--scene-file')

const ENTRY = `
import { sceneGridOf } from './scene'
import { hdSceneGridOf } from './scene-hd'
import { daylightAt } from './hd-daylight'
import { advisorSpriteOf } from './advisor-art'
import { SCENES } from './scenes/index'
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
export const gridOf = ({ scene, render, columns, tick, hour, caption }) => {
  const definition = typeof scene === 'string' ? SCENES[scene] : scene
  const advisor = { sprite: advisorSpriteOf(definition), gesture: 'approved', age: 30, bubble: 'kept Opus' }
  return render === 'hd'
    ? hdSceneGridOf({ scene: definition, phase: 'build', columns, rows: 9, tick, caption, since: 0,
        action: 'edit', light: daylightAt(hour), party: PARTY, lead: 'Lead', advisor })
    : sceneGridOf(definition, 'build', columns, tick, caption, 0, undefined, false, 'edit', advisor)
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
  const { SCENE_IDS, gridOf, sceneOfFile } = await import(pathToFileURL(bundle).href)
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
  // One sheet per scene with its six captures labelled, so a whole scene is looked at in one image.
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
    const before = shots.length
    for (const columns of [130, 60]) {
      const caption = 'Editing scene-hd.ts'
      await shoot(
        `${id}-classic-${columns}`,
        gridOf({ scene, render: 'classic', columns, tick: 41, caption }),
        columns
      )
      for (const [time, hour] of [
        ['day', 12],
        ['night', 22]
      ]) {
        const grid = gridOf({ scene, render: 'hd', columns, tick: 41, hour, caption })
        await shoot(`${id}-hd-${time}-${columns}`, grid, columns)
      }
    }
    const names = shots.slice(before).map((path) => path.slice(out.length + 1, -'.png'.length))
    await sheetOf(id, names)
  }
  await browser.close()
  await rm(bundle)
  await writeFile(join(out, 'index.txt'), `${shots.join('\n')}\n`)
  process.stdout.write(`${shots.length} captures in ${out}\n`)
}

await main()
