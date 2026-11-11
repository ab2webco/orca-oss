import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES,
  orchestratorGameSceneArtFiles,
  orchestratorGameSceneArtIssues,
  orchestratorGameSceneArtOf,
  orchestratorGameSceneDrawnStyle,
  orchestratorGameSceneNativeOf
} from './orchestrator-game-scene-native'
import {
  orchestratorGameSceneIssues,
  orchestratorGameScenesOf,
  parseOrchestratorGameScene
} from './orchestrator-game-scene'
import { sceneFile as scene } from './__fixtures__/orchestrator-game-scene'

const role = (sheet = 'art/lead.png') => ({
  sheets: [sheet],
  frame: { width: 32, height: 48 },
  size: 58,
  animations: { idle: { row: 0, frames: 2 }, walk: { row: 1, frames: 4, fps: 10 } }
})

const native = () => ({
  figures: {
    layers: [{ src: 'art/sky.png' }, { src: 'art/bushes.webp', front: true }],
    roles: { lead: role(), member: role('art/member.png') }
  }
})

/** A PNG header is all the dimension reader needs. */
const png = (width: number, height: number, bytes = 33): Uint8Array => {
  const out = new Uint8Array(bytes)
  out.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(out.buffer).setUint32(16, width)
  new DataView(out.buffer).setUint32(20, height)
  return out
}

/** A WebP extended header: a RIFF container and a VP8X chunk with the canvas size. */
const webp = (width: number, height: number): Uint8Array => {
  const out = new Uint8Array(30)
  const view = new DataView(out.buffer)
  const ascii = (at: number, text: string): void =>
    out.set(
      [...text].map((one) => one.charCodeAt(0)),
      at
    )
  ascii(0, 'RIFF')
  view.setUint32(4, out.byteLength - 8, true)
  ascii(8, 'WEBP')
  ascii(12, 'VP8X')
  view.setUint32(16, 10, true)
  view.setUint16(24, (width - 1) & 0xffff, true)
  view.setUint16(27, (height - 1) & 0xffff, true)
  return out
}

const parsedNative = (value: unknown) => {
  const { native: parsed, issues } = orchestratorGameSceneNativeOf({ native: value })
  expect(issues).toEqual([])
  return parsed!
}

describe('the native art block', () => {
  it('is carried on the definition, with a scene that has none unchanged', () => {
    const parsed = parseOrchestratorGameScene(JSON.stringify(scene({ native: native() })), 'x')
    const plain = parseOrchestratorGameScene(JSON.stringify(scene()), 'x')
    expect(parsed.ok && parsed.definition.native?.figures?.layers).toHaveLength(2)
    expect(parsed.ok && parsed.warnings).toEqual([])
    expect(plain.ok && 'native' in plain.definition).toBe(false)
  })

  it('costs only itself when it is broken: the scene still draws, with a warning', () => {
    const broken = scene({ native: { figures: { layers: [], roles: {} } } })
    const parsed = parseOrchestratorGameScene(JSON.stringify(broken), 'x')
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.definition.native).toBeUndefined()
    expect(parsed.ok && parsed.warnings[0]).toMatch(/^native\.figures\.layers:/)
  })

  it('lists every problem the way validate reports them', () => {
    const issues = orchestratorGameSceneIssues(
      JSON.stringify(scene({ native: { office: { layers: [{ src: '../sky.png' }], roles: {} } } }))
    )
    expect(issues).toContain(
      'native.office.layers.0.src: must stay inside the scene folder (no ..)'
    )
    expect(issues.some((one) => one.startsWith('native.office.roles.lead:'))).toBe(true)
    expect(issues.some((one) => one.startsWith('native.office.roles.member:'))).toBe(true)
  })

  it('keeps a walk stride and refuses a broken one', () => {
    const walking = (stride: unknown) => ({
      figures: {
        ...native().figures,
        roles: {
          ...native().figures.roles,
          lead: {
            ...role(),
            animations: { idle: { row: 0, frames: 1 }, walk: { row: 1, frames: 4, stride } }
          }
        }
      }
    })
    const kept = orchestratorGameSceneNativeOf({ native: walking(35) })
    expect(kept.native?.figures?.roles.lead.animations.walk?.stride).toBe(35)
    const { issues } = orchestratorGameSceneNativeOf({ native: walking(0) })
    expect(issues[0]).toMatch(/^native\.figures\.roles\.lead\.animations\.walk\.stride:/)
  })

  it.each([
    ['/etc/sky.png', 'must be relative to the scene file, not absolute'],
    ['C:\\art\\sky.png', 'must be relative to the scene file, not absolute'],
    ['art/../../sky.png', 'must stay inside the scene folder (no ..)'],
    ['art/sky.gif', 'must be a .png or .webp file'],
    ['art/sky', 'must be a .png or .webp file']
  ])('refuses the art path %s', (src, message) => {
    const { issues } = orchestratorGameSceneNativeOf({
      native: { figures: { ...native().figures, layers: [{ src }] } }
    })
    expect(issues).toEqual([`native.figures.layers.0.src: ${message}`])
  })

  it('needs an idle for every role, the frame an unnamed action falls back to', () => {
    const noIdle = { ...role(), animations: { walk: { row: 0, frames: 2 } } }
    const { issues } = orchestratorGameSceneNativeOf({
      native: { figures: { ...native().figures, roles: { lead: noIdle, member: role() } } }
    })
    expect(issues[0]).toMatch(/^native\.figures\.roles\.lead\.animations\.idle:/)
  })

  it('refuses an action the engine does not act out, so a typo is not a silent idle', () => {
    const typo = {
      ...role(),
      animations: { idle: { row: 0, frames: 1 }, wlak: { row: 1, frames: 2 } }
    }
    const { issues } = orchestratorGameSceneNativeOf({
      native: { figures: { ...native().figures, roles: { lead: typo, member: role() } } }
    })
    expect(issues.join()).toContain('wlak')
  })

  it('lets a scene rename an action and swap the station prop', () => {
    const renamed = {
      ...role(),
      animations: {
        idle: { row: 0, frames: 2 },
        work: { row: 1, frames: 2, label: { en: 'Forging', es: 'Forjando' } }
      }
    }
    const parsed = parsedNative({
      office: {
        layers: [{ src: 'room.png' }],
        roles: { lead: renamed, member: role() },
        props: { station: 'desk.png' }
      }
    })
    expect(parsed.office?.roles.lead.animations.work?.label).toEqual({
      en: 'Forging',
      es: 'Forjando'
    })
    expect(parsed.office?.props?.station).toBe('desk.png')
  })

  it('places a station by its floor point, and refuses one that is not a pixel', () => {
    const office = (stationFeet: unknown) => ({
      office: {
        layers: [{ src: 'room.png' }],
        roles: { lead: role(), member: role() },
        props: { station: 'desk.png', stationFeet }
      }
    })
    expect(parsedNative(office({ x: 120, y: 120 })).office?.props?.stationFeet).toEqual({
      x: 120,
      y: 120
    })
    expect(
      orchestratorGameSceneNativeOf({ native: office({ x: -1, y: 2.5 }) }).issues
    ).toHaveLength(2)
  })

  it('lets a layer drift across the stage, within a sane speed', () => {
    const drifting = (drift: number) => ({
      figures: { ...native().figures, layers: [{ src: 'art/sky.png', drift }] }
    })
    expect(parsedNative(drifting(6)).figures?.layers[0]?.drift).toBe(6)
    expect(orchestratorGameSceneNativeOf({ native: drifting(500) }).issues).toHaveLength(1)
  })

  it('names each file once, canonical and relative to the scene', () => {
    const parsed = parsedNative({
      figures: {
        ...native().figures,
        layers: [{ src: './art//sky.png' }],
        roles: { lead: role(), member: { ...role(), sheets: ['art/lead.png', 'art/two.png'] } },
        props: { station: 'art/anvil.png' }
      }
    })
    expect(orchestratorGameSceneArtFiles(parsed).sort()).toEqual([
      'art/anvil.png',
      'art/lead.png',
      'art/sky.png',
      'art/two.png'
    ])
  })
})

describe('the art files of a scene', () => {
  const sizes: Record<string, Uint8Array> = {
    'art/sky.png': png(960, 352),
    'art/bushes.webp': png(960, 352),
    'art/lead.png': png(64, 96),
    'art/member.png': png(128, 96)
  }
  const read = (over: Record<string, Uint8Array | string> = {}) => {
    const files = { ...sizes, ...over }
    return async (src: string) => {
      const file = files[src]
      return file === undefined
        ? { error: 'not found' }
        : typeof file === 'string'
          ? { error: file }
          : { bytes: file }
    }
  }

  it('is clean when every file reads and every animation fits its sheet', async () => {
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative(native()),
      read({
        'art/lead.png': png(128, 96)
      })
    )
    expect(issues).toEqual([])
  })

  it('reads a real WebP header, so the format the block accepts is one it can measure', async () => {
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative({
        figures: {
          ...native().figures,
          roles: { lead: role('art/hero.webp'), member: role('art/hero.webp') }
        }
      }),
      read({ 'art/bushes.webp': webp(960, 352), 'art/hero.webp': webp(64, 96) })
    )
    // Why the walk issue: a measured 64x96 sheet is too narrow, which only a parsed header can say.
    expect(issues).toHaveLength(2)
    expect(issues[0]).toContain('art/hero.webp to be at least 128x96, it is 64x96')
  })

  it('names a missing file, an unreadable one and a link out by their place in the block', async () => {
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative(native()),
      read({ 'art/sky.png': 'resolves outside the scene folder', 'art/bushes.webp': 'not found' })
    )
    expect(issues).toContain('native.figures.layers.0.src: resolves outside the scene folder')
    expect(issues).toContain('native.figures.layers.1.src: not found')
  })

  it('refuses an animation that runs past its sheet', async () => {
    const issues = await orchestratorGameSceneArtIssues(parsedNative(native()), read())
    expect(issues).toContain(
      'native.figures.roles.lead.animations.walk: 4 frames in row 1 need art/lead.png to be at least 128x96, it is 64x96'
    )
  })

  it('refuses a file over the cap, which is what keeps art out of the 64 KB JSON cheap', async () => {
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative(native()),
      read({
        'art/lead.png': png(128, 96),
        'art/sky.png': png(960, 352, ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES + 1)
      })
    )
    expect(issues).toEqual([
      `native.figures.layers.0.src: larger than ${ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES / 1024 / 1024} MB`
    ])
  })

  it('refuses a file that is not an image', async () => {
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative(native()),
      read({ 'art/lead.png': png(128, 96), 'art/sky.png': new Uint8Array([1, 2, 3]) })
    )
    expect(issues).toEqual(['native.figures.layers.0.src: is not a PNG or WebP image'])
  })

  it('caps the bytes a style loads across its files', async () => {
    const big = png(128, 96, ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES)
    const layers = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ src: `art/${name}.png` }))
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative({ figures: { ...native().figures, layers } }),
      read({
        'art/lead.png': png(128, 96),
        ...Object.fromEntries(layers.map((layer) => [layer.src, big]))
      })
    )
    expect(issues.join()).toMatch(/^native\.figures: its files add up to 10\.0 MB/)
  })

  it('caps the pixels a style decodes, the memory it costs however small the files are', async () => {
    const issues = await orchestratorGameSceneArtIssues(
      parsedNative(native()),
      read({ 'art/lead.png': png(128, 96), 'art/sky.png': png(8192, 8192) })
    )
    expect(issues.join()).toMatch(/^native\.figures: decodes to .* MP, more than the \d+ MP/)
  })
})

describe('the art a scene draws with', () => {
  const definition = (value: unknown) => {
    const parsed = parseOrchestratorGameScene(JSON.stringify(scene({ native: value })), 'x')
    return parsed.ok ? parsed.definition : undefined
  }
  const PIXEL = { drawn: 'pixel', art: 'pixel', defaultArt: false }

  it('keeps Pixel for every scene when Pixel is picked', () => {
    expect(orchestratorGameSceneArtOf({ style: 'pixel', sceneId: 'quest' })).toEqual(PIXEL)
    expect(
      orchestratorGameSceneArtOf({
        style: 'pixel',
        sceneId: 'file:a.json',
        scene: definition(native())
      })
    ).toEqual(PIXEL)
  })

  it('draws Quest with the art Orca ships, which is its own', () => {
    for (const style of ['figures', 'office'] as const) {
      expect(orchestratorGameSceneArtOf({ style, sceneId: 'quest' })).toEqual({
        drawn: style,
        art: 'bundled',
        defaultArt: false
      })
    }
  })

  it.each(['vigilante', 'jrpg', 'tamer'])(
    'draws the built-in %s in the chosen style with the default art, never Pixel',
    (sceneId) => {
      for (const style of ['figures', 'office'] as const) {
        expect(orchestratorGameSceneArtOf({ style, sceneId })).toEqual({
          drawn: style,
          art: 'bundled',
          defaultArt: true
        })
      }
    }
  )

  it('draws a plugin scene with no art with the default art', () => {
    const { scenes } = orchestratorGameScenesOf([
      { pluginId: 'acme.pack', id: 'space', text: JSON.stringify(scene()) }
    ])
    expect(
      orchestratorGameSceneArtOf({
        style: 'figures',
        sceneId: scenes[0]!.id,
        scene: scenes[0]!.definition
      })
    ).toEqual({ drawn: 'figures', art: 'bundled', defaultArt: true })
  })

  it('draws a scene file with its own art where its block covers the style, else the default', () => {
    const scene = definition(native())
    expect(orchestratorGameSceneArtOf({ style: 'figures', sceneId: 'file:a.json', scene })).toEqual(
      { drawn: 'figures', art: 'scene', defaultArt: false }
    )
    expect(orchestratorGameSceneArtOf({ style: 'office', sceneId: 'file:a.json', scene })).toEqual({
      drawn: 'office',
      art: 'bundled',
      defaultArt: true
    })
  })

  it('draws the default art when a broken block was dropped or its own art did not load', () => {
    const DEFAULT = { drawn: 'figures', art: 'bundled', defaultArt: true }
    expect(
      orchestratorGameSceneArtOf({
        style: 'figures',
        sceneId: 'file:a.json',
        scene: definition({ figures: { layers: [] } })
      })
    ).toEqual(DEFAULT)
    expect(
      orchestratorGameSceneArtOf({
        style: 'figures',
        sceneId: 'file:a.json',
        scene: definition(native()),
        sceneArtFailed: true
      })
    ).toEqual(DEFAULT)
  })

  it('draws a scene file that did not read with the default art', () => {
    expect(orchestratorGameSceneArtOf({ style: 'figures', sceneId: 'file:a.json' })).toEqual({
      drawn: 'figures',
      art: 'bundled',
      defaultArt: true
    })
  })

  it('falls to Pixel only when the bundled art itself failed', () => {
    expect(
      orchestratorGameSceneArtOf({ style: 'figures', sceneId: 'quest', bundledArtFailed: true })
    ).toEqual(PIXEL)
    expect(
      orchestratorGameSceneArtOf({
        style: 'office',
        sceneId: 'file:a.json',
        scene: definition(native()),
        bundledArtFailed: true
      })
    ).toEqual(PIXEL)
  })

  it('keeps a scene own art when only the bundled art failed', () => {
    expect(
      orchestratorGameSceneArtOf({
        style: 'figures',
        sceneId: 'file:a.json',
        scene: definition(native()),
        bundledArtFailed: true
      })
    ).toEqual({ drawn: 'figures', art: 'scene', defaultArt: false })
  })

  it.each(['file:.orca/scenes/quest.json', 'file:other/quest.json', 'file:quest.json'])(
    'reads the scene file %s as Quest, so its bundled art is its own',
    (sceneId) => {
      expect(orchestratorGameSceneArtOf({ style: 'office', sceneId })).toEqual({
        drawn: 'office',
        art: 'bundled',
        defaultArt: false
      })
    }
  )

  it.each(['file:.orca/scenes/quests.json', 'file:.orca/quest/space.json', 'file:my-quest.json'])(
    'does not read %s as Quest',
    (sceneId) => {
      expect(orchestratorGameSceneArtOf({ style: 'office', sceneId }).defaultArt).toBe(true)
    }
  )

  it('keeps the drawn style alone for readers that need only that', () => {
    expect(orchestratorGameSceneDrawnStyle({ style: 'figures', sceneId: 'vigilante' })).toBe(
      'figures'
    )
    expect(orchestratorGameSceneDrawnStyle({ style: 'pixel', sceneId: 'quest' })).toBe('pixel')
  })
})
