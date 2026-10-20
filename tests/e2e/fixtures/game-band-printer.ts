// ORCA-692: prints the mod's own hd band, driven by /quest demo, into a real PTY the way an
// Agent Teams pane shows it. ORCA_BAND_SCENE_FILE draws a scene JSON (as `sceneFile` would) and
// ORCA_BAND_HOUR fixes the light, so before/after captures compare like with like.
import { readFileSync } from 'node:fs'
import {
  demoFrameOf,
  DEMO_STEP_TICKS
} from '../../../resources/claude-plugins/orca-game/hooks/demo'
import { daylightAt } from '../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { HdMember } from '../../../resources/claude-plugins/orca-game/hooks/hd-party'
import { UPPER_HALF } from '../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import { SCENE_TICK_MS } from '../../../resources/claude-plugins/orca-game/hooks/scene'
import { hdRowsOf, hdSceneGridOf } from '../../../resources/claude-plugins/orca-game/hooks/scene-hd'
import { QUEST_SCENE } from '../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { sceneDefinitionOf } from '../../../resources/claude-plugins/orca-game/hooks/scenes/scene-shape'

const ESC = '\u001b['
const rgb = (color: number): string => `${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}`

const sceneFile = process.env.ORCA_BAND_SCENE_FILE
const scene =
  sceneFile === undefined || sceneFile === ''
    ? QUEST_SCENE
    : (sceneDefinitionOf(JSON.parse(readFileSync(sceneFile, 'utf8')), `file:${sceneFile}`) ??
      QUEST_SCENE)
const hour = Number(process.env.ORCA_BAND_HOUR ?? '')
const light = Number.isFinite(hour) && process.env.ORCA_BAND_HOUR ? daylightAt(hour) : undefined
const party: HdMember[] = [
  { key: 'builder', phase: 'build', state: 'working' },
  { key: 'tester', phase: 'verify', state: 'working' },
  { key: 'scribe', phase: 'docs', state: 'waiting' }
]

const draw = (tick: number): string => {
  const columns = process.stdout.columns || 80
  const viewport = process.stdout.rows || 40
  const rows = hdRowsOf(viewport)
  const frame = demoFrameOf(Math.floor(tick / DEMO_STEP_TICKS))
  const grid = hdSceneGridOf({
    scene,
    phase: frame.phase,
    columns,
    rows,
    tick,
    caption: frame.caption,
    since: 0,
    action: frame.action,
    isResting: frame.isResting,
    party,
    lead: 'Lead',
    light
  })
  // Why at the bottom: the band sits above Claude Code's prompt, with output scrolling above it.
  const top = Math.max(1, viewport - rows - 2)
  let out = `${ESC}${top - 1};1H${ESC}0m${ESC}2K● ${scene.id} band (ORCA-692 fixture)`
  for (let y = 0; y < rows; y += 1) {
    out += `${ESC}${top + y};1H`
    for (let x = 0; x < columns; x += 1) {
      const [glyph = 0x20, fg = 0, bg = 0] = grid[y * columns + x] ?? []
      out += `${ESC}38;2;${rgb(fg)}m${ESC}48;2;${rgb(bg)}m${String.fromCodePoint(glyph || UPPER_HALF)}`
    }
    out += `${ESC}0m`
  }
  out += `${ESC}${top + rows};1H${ESC}2K  ${frame.caption}${ESC}${top + rows + 1};1H${ESC}2K> `
  return out
}

process.stdout.write(`${ESC}?25l${ESC}2J`)
for (let line = 1; line < (process.stdout.rows || 40) - 14; line += 1) {
  process.stdout.write(`${ESC}${line};1H${ESC}2;37mlead · earlier output line ${line}${ESC}0m`)
}
let tick = 0
setInterval(() => {
  tick += 1
  process.stdout.write(draw(tick))
}, SCENE_TICK_MS)
