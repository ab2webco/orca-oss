import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  orchestratorGameSceneArtFiles,
  orchestratorGameSceneArtIssues,
  orchestratorGameSceneNativeOf
} from '../../../src/shared/orchestrator-game-scene-native'
import { PNG } from 'pngjs'
import { QUEST_ACTIONS } from './quest-art-pose.mjs'

const ART = resolve(import.meta.dirname, '../../../src/renderer/src/assets/quest-art')

const readArt = async (src) => {
  try {
    return { bytes: await readFile(join(ART, src)) }
  } catch {
    return { error: 'not found' }
  }
}

const manifest = async () => JSON.parse(await readFile(join(ART, 'native.json'), 'utf8'))

describe('the generated Quest art', () => {
  it('passes the same parser and art checks as any scene', async () => {
    const { native, issues } = orchestratorGameSceneNativeOf(await manifest())
    expect(issues).toEqual([])
    expect(Object.keys(native).sort()).toEqual(['figures', 'office'])
    expect(await orchestratorGameSceneArtIssues(native, readArt)).toEqual([])
  })

  it('would report a sheet that went missing, so the check above can fail', async () => {
    const { native } = orchestratorGameSceneNativeOf(await manifest())
    const gone = native.figures.roles.member.sheets[2]
    const issues = await orchestratorGameSceneArtIssues(native, (src) =>
      src === gone ? { error: 'not found' } : readArt(src)
    )
    expect(issues).toEqual([expect.stringContaining('not found')])
  })

  it('acts out all seven actions for every role, with eight member looks', async () => {
    const { native } = orchestratorGameSceneNativeOf(await manifest())
    for (const style of [native.figures, native.office]) {
      expect(style.roles.member.sheets).toHaveLength(8)
      for (const role of [style.roles.lead, style.roles.member, style.roles.advisor]) {
        expect(Object.keys(role.animations).sort()).toEqual(Object.keys(QUEST_ACTIONS).sort())
      }
    }
  })

  // ORCA-1139: the panel lights this rectangle per state, so it must be the monitor's screen.
  it("puts the office desk's screen rectangle on the monitor's screen pixels", async () => {
    const { native } = orchestratorGameSceneNativeOf(await manifest())
    const { station, stationScreen: s } = native.office.props
    const desk = PNG.sync.read(readFileSync(join(ART, station)))
    const off = []
    for (let y = s.y; y < s.y + s.height; y++) {
      for (let x = s.x; x < s.x + s.width; x++) {
        const i = (y * desk.width + x) * 4
        const rgb = [...desk.data.subarray(i, i + 3)].map((c) => c.toString(16).padStart(2, '0'))
        if (rgb.join('') !== '0f1826') {
          off.push(`${x},${y}`)
        }
      }
    }
    expect(off).toEqual([])
  })

  it('names no file outside its own style folder', async () => {
    const { native } = orchestratorGameSceneNativeOf(await manifest())
    const files = orchestratorGameSceneArtFiles(native)
    expect(files.every((file) => /^(figures|office)\/[a-z0-9-]+\.png$/.test(file))).toBe(true)
  })
})
