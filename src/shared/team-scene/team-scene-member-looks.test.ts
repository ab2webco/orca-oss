import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
  FIGURES_ADVISOR_LOOK,
  FIGURES_LEAD_LOOK,
  FIGURES_MEMBER_LOOKS,
  teamSceneLookSeedOf,
  teamSceneMemberLookOf,
  teamSceneSheetIndexOf,
  type TeamSceneFigureLook
} from './team-scene-member-looks'

const ART = join(__dirname, '../../renderer/src/assets/quest-art')
type Roles = Record<'lead' | 'member' | 'advisor', { sheets: string[] }>
// Why read, not imported: the node project does not list the renderer's assets (TS6307).
const roles = (
  JSON.parse(readFileSync(join(ART, 'native.json'), 'utf8')) as {
    native: { figures: { roles: Roles } }
  }
).native.figures.roles

type Rgb = [number, number, number]
const rgbOf = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
const far = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The most common opaque colours of a box of the sheet's first frame, coarsely binned. */
function dominant(sheet: string, box: [number, number, number, number], n: number): Rgb[] {
  const png = PNG.sync.read(readFileSync(join(ART, sheet)))
  const bins = new Map<string, { rgb: Rgb; count: number }>()
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const i = (y * png.width + x) * 4
      if (png.data[i + 3]! < 250) {
        continue
      }
      const rgb: Rgb = [png.data[i]! & ~7, png.data[i + 1]! & ~7, png.data[i + 2]! & ~7]
      const bin = bins.get(rgb.join()) ?? { rgb, count: 0 }
      bin.count += 1
      bins.set(rgb.join(), bin)
    }
  }
  return [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((b) => b.rgb)
}

const HEAD: [number, number, number, number] = [40, 20, 90, 62]
const BODY: [number, number, number, number] = [40, 66, 80, 92]
const near = (hex: number, colours: Rgb[]) => colours.some((c) => far(rgbOf(hex), c) < 48)

const expectDrawnLike = (look: TeamSceneFigureLook) => {
  const head = dominant(look.sheet, HEAD, 4)
  expect(near(look.headwear === 'hair' ? look.hair : look.headwearColor, head.slice(0, 3))).toBe(
    true
  )
  // Why not under a helm: it hides the face in the sheet.
  if (look.headwear !== 'helm') {
    expect(near(look.skin, head)).toBe(true)
  }
  expect(near(look.tunic, dominant(look.sheet, BODY, 4))).toBe(true)
}

describe('the Figures member looks', () => {
  it('has one look per member sheet, in the sheets order', () => {
    expect(FIGURES_MEMBER_LOOKS.map((look) => look.sheet)).toEqual(roles.member.sheets)
    expect(FIGURES_LEAD_LOOK.sheet).toBe(roles.lead.sheets[0])
    expect(FIGURES_ADVISOR_LOOK.sheet).toBe(roles.advisor.sheets[0])
  })

  it.each([...FIGURES_MEMBER_LOOKS, FIGURES_LEAD_LOOK, FIGURES_ADVISOR_LOOK])(
    'matches the headwear, skin and main colour drawn in $sheet',
    expectDrawnLike
  )

  it('picks the sheet the Team list face draws, by the persistent character before the pane', () => {
    const subject = { role: 'member' as const, key: 'pane-1', characterKey: 'char-ada' }
    const index = teamSceneSheetIndexOf(subject, roles.member.sheets.length)
    expect(index).toBe(teamSceneLookSeedOf('char-ada') % roles.member.sheets.length)
    expect(teamSceneMemberLookOf(subject).sheet).toBe(roles.member.sheets[index])
    expect(teamSceneMemberLookOf({ ...subject, key: 'pane-9' })).toBe(
      teamSceneMemberLookOf(subject)
    )
    const paneOnly = { role: 'member' as const, key: 'pane-1', characterKey: null }
    const byPane = teamSceneSheetIndexOf(paneOnly, roles.member.sheets.length)
    expect(teamSceneMemberLookOf(paneOnly).sheet).toBe(roles.member.sheets[byPane])
  })

  it('draws the lead and the advisor with their own sheets', () => {
    expect(teamSceneMemberLookOf({ role: 'lead', key: 'x', characterKey: null })).toBe(
      FIGURES_LEAD_LOOK
    )
    expect(teamSceneMemberLookOf({ role: 'advisor', key: 'x', characterKey: null })).toBe(
      FIGURES_ADVISOR_LOOK
    )
  })

  it('refuses the steward, which only the 2D scenes draw, from its own sheet', () => {
    // @ts-expect-error a steward has no 3D look.
    teamSceneMemberLookOf({ role: 'steward', key: 'x', characterKey: null })
    const all = roles as unknown as Record<string, { sheets: string[] }>
    expect(all.steward?.sheets).toEqual(['figures/steward.png'])
  })

  it('keeps the seed the image painter has always used, so no face changes', () => {
    // FNV-1a of 'a', as figureSeedOf returned it before the move.
    expect(teamSceneLookSeedOf('a')).toBe(0xe40c292c)
  })
})
