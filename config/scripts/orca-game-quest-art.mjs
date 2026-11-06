#!/usr/bin/env node
// Generates Quest's original native art: every image here is drawn by this code, so its license is
// the repo's. It writes the sheets, the stages and the `native` block that names them.
// Usage: node config/scripts/orca-game-quest-art.mjs [--out <dir>] [--preview <dir>]
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../..')
const argOf = (name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}
const out = resolve(argOf('--out') ?? join(root, 'src/renderer/src/assets/quest-art'))
const previewDir = argOf('--preview')

const ENTRY = `
import { QUEST_ACTIONS, WALK_CYCLE_UNITS } from './quest-art-pose.mjs'
import { FIGURES_CAST, OFFICE_CAST } from './quest-art-cast.mjs'
import { drawCharacter } from './quest-art-rig.mjs'
import * as stage from './quest-art-stage.mjs'

const FRAME = { width: 128, height: 128, feetY: 122, scale: 2 }
const png = (width, height, paint) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paint(canvas.getContext('2d', { willReadFrequently: true }))
  return canvas.toDataURL('image/png')
}
// What a sheet must not ship: a frame into its neighbour, which plays as a sliver; an empty frame,
// which plays as a blink; or feet off the declared row, which float or sink the character.
const cellFaults = (g, rows) => {
  const faults = []
  for (const { row, frames } of rows) {
    for (let frame = 0; frame < frames; frame++) {
      const left = frame * FRAME.width
      const top = row * FRAME.height
      const { data } = g.getImageData(left, top, FRAME.width, FRAME.height)
      let lowest = -1
      let edge = false
      for (let at = 3; at < data.length; at += 4) {
        if (data[at] === 0) continue
        const x = ((at - 3) / 4) % FRAME.width
        const y = Math.floor((at - 3) / 4 / FRAME.width)
        lowest = Math.max(lowest, y)
        edge ||= x === 0 || x === FRAME.width - 1 || y === 0 || y === FRAME.height - 1
      }
      const name = 'row ' + row + ' frame ' + frame
      if (edge) faults.push(name + ' touches its cell edge')
      if (lowest === -1) faults.push(name + ' is empty')
      else if (Math.abs(lowest - FRAME.feetY) > 3) faults.push(name + ' has feet at ' + lowest)
    }
  }
  return faults
}
const casts = { figures: FIGURES_CAST, office: OFFICE_CAST }
const looksOf = (cast) => ({ lead: cast.lead, advisor: cast.advisor,
  ...Object.fromEntries(cast.members.map((look, at) => ['member-' + (at + 1), look])) })
window.questArt = {
  actions: {
    ...QUEST_ACTIONS,
    walk: { ...QUEST_ACTIONS.walk, stride: Math.round(WALK_CYCLE_UNITS * FRAME.scale) }
  },
  frame: FRAME,
  names: (style) => Object.keys(looksOf(casts[style])),
  sheet: (style, name) => {
    const look = looksOf(casts[style])[name]
    const rows = Object.values(QUEST_ACTIONS)
    let faults = []
    const url = png(FRAME.width * 8, FRAME.height * rows.length, (g) => {
      for (const { row, frames } of rows) {
        const action = Object.keys(QUEST_ACTIONS).find((one) => QUEST_ACTIONS[one].row === row)
        for (let frame = 0; frame < frames; frame++) {
          g.save()
          g.translate(FRAME.width * (frame + 0.5), FRAME.height * row + FRAME.feetY)
          g.scale(FRAME.scale, FRAME.scale)
          drawCharacter(g, look, action, frame / frames)
          g.restore()
        }
      }
      faults = cellFaults(g, rows)
    })
    return { url, faults }
  },
  layer: (name) => png(stage.STAGE.width * 2, stage.STAGE.height * 2, (g) => {
    g.scale(2, 2)
    stage[name](g)
  }),
  prop: (name, width, height) => png(width * 2, height * 2, (g) => {
    g.scale(2, 2)
    stage[name](g)
  })
}
`

const SHEET_FRAME = { width: 128, height: 128 }
// Why 60: a figure fills about 100 of the frame's 128 rows, so it stands 47 CSS px at the front.
const SIZE = 60
// Where the generator plants every frame's feet.
const FEET = { x: 64, y: 122 }

const roleOf = (sheets, actions, labels = {}) => ({
  sheets,
  frame: SHEET_FRAME,
  feet: FEET,
  size: SIZE,
  animations: Object.fromEntries(
    Object.entries(actions).map(([action, spec]) => [
      action,
      labels[action] ? { ...spec, label: labels[action] } : spec
    ])
  )
})

const styleOf = (style, names, layers, station, actions) => ({
  layers,
  roles: {
    lead: roleOf([`${style}/lead.png`], actions),
    member: roleOf(
      names.filter((name) => name.startsWith('member-')).map((name) => `${style}/${name}.png`),
      actions
    ),
    advisor: roleOf([`${style}/advisor.png`], actions)
  },
  props: { station }
})

const writeUrl = async (path, url) => {
  await writeFile(path, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
}

async function main() {
  await mkdir(join(out, 'figures'), { recursive: true })
  await mkdir(join(out, 'office'), { recursive: true })
  const { outputFiles } = await build({
    stdin: { contents: ENTRY, resolveDir: join(root, 'config/scripts/quest-art'), loader: 'js' },
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'warning'
  })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.addScriptTag({ content: outputFiles[0].text })
  const actions = await page.evaluate(() => window.questArt.actions)
  const native = {}
  for (const style of ['figures', 'office']) {
    const names = await page.evaluate((one) => window.questArt.names(one), style)
    for (const name of names) {
      const { url, faults } = await page.evaluate(
        ([one, who]) => window.questArt.sheet(one, who),
        [style, name]
      )
      if (faults.length > 0) {
        throw new Error(`${style}/${name}: ${faults.join(', ')}`)
      }
      await writeUrl(join(out, style, `${name}.png`), url)
    }
    const layers =
      style === 'figures'
        ? [
            ['paintFiguresSky', 'sky'],
            ['paintFiguresLand', 'land'],
            ['paintFiguresFront', 'grass']
          ]
        : [['paintOfficeRoom', 'room']]
    for (const [paint, name] of layers) {
      const url = await page.evaluate((one) => window.questArt.layer(one), paint)
      await writeUrl(join(out, style, `${name}.png`), url)
    }
    const [paint, name, width, height] =
      style === 'figures' ? ['paintForge', 'forge', 120, 48] : ['paintDesk', 'desk', 120, 64]
    const propUrl = await page.evaluate(
      ([one, w, h]) => window.questArt.prop(one, w, h),
      [paint, width, height]
    )
    await writeUrl(join(out, style, `${name}.png`), propUrl)
    native[style] = styleOf(
      style,
      names,
      layers.map(([, layer]) => ({
        src: `${style}/${layer}.png`,
        ...(layer === 'grass' ? { front: true } : {})
      })),
      `${style}/${name}.png`,
      actions
    )
  }
  const manifest = join(out, 'native.json')
  await writeFile(manifest, `${JSON.stringify({ native }, null, 2)}\n`)
  // The commit hook formats it, so a run on clean art must leave the same bytes.
  execFileSync(process.execPath, [join(root, 'node_modules/oxfmt/bin/oxfmt'), manifest])
  if (previewDir) {
    const { previewQuestArt } = await import(
      pathToFileURL(join(root, 'config/scripts/quest-art/quest-art-preview.mjs')).href
    )
    await previewQuestArt({ browser, out, previewDir: resolve(previewDir), native, readFile })
  }
  await browser.close()
}

await main()
