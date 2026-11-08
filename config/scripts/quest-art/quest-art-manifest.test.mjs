import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  orchestratorGameSceneArtFiles,
  orchestratorGameSceneArtIssues,
  orchestratorGameSceneNativeOf
} from '../../../src/shared/orchestrator-game-scene-native'
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

  it('names no file outside its own style folder', async () => {
    const { native } = orchestratorGameSceneNativeOf(await manifest())
    const files = orchestratorGameSceneArtFiles(native)
    expect(files.every((file) => /^(figures|office)\/[a-z0-9-]+\.png$/.test(file))).toBe(true)
  })
})
