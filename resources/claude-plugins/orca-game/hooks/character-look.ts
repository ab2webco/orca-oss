import { bodyOf, derivedVariantOf, lookKeyOf } from './character-derived-look'
import type { LocalizedName } from './game-strings'
import { shortMemberNameOf } from './member-character'
import type {
  CharacterAccessory,
  CharacterVariant,
  Costume,
  SceneCharacter,
  SceneDefinition,
  ScenePhase
} from './scenes/index'

// A member is one figure in every phase: its own costumes, or one body under its variant or a derived one.

type Head = { up: number; top: number; from: number; to: number; centre: number }
type Cell = readonly [x: number, y: number]

// Why only empty cells around the head: no costume's art is covered, so any accessory fits any scene.
const ACCESSORY_ART: Readonly<
  Record<
    CharacterAccessory,
    { color: number; cells: (head: Head, rows: readonly string[]) => Cell[] }
  >
> = {
  crown: {
    color: 0xffd84a,
    cells: ({ up, centre }) => [-2, 0, 2].map((dx): Cell => [centre + dx, up])
  },
  halo: {
    color: 0xfff3a0,
    cells: ({ up, centre }) => [-2, -1, 0, 1, 2].map((dx): Cell => [centre + dx, up])
  },
  horns: {
    color: 0xe8e0c8,
    cells: ({ up, from, to }) => [
      [from, up],
      [to, up]
    ]
  },
  antenna: {
    color: 0x9aa3ab,
    cells: ({ up, centre }) => [
      [centre, up],
      [centre, up - 1]
    ]
  },
  bow: {
    color: 0xe0405a,
    cells: ({ up, top, to }) => [
      [to, up],
      [to + 1, up],
      [to + 1, top]
    ]
  },
  feather: {
    color: 0x4fc3f7,
    cells: ({ up, top, from }) => [
      [from - 2, up],
      [from - 1, up],
      [from - 1, top]
    ]
  },
  // Behind the body: the hero faces right, so the cape trails on its left.
  cape: {
    color: 0xb03a48,
    cells: ({ top }, rows) =>
      rows.flatMap((row, y): Cell[] => {
        const left = row.search(/[^.]/)
        return y >= top + 2 && left > 0 ? [[left - 1, y]] : []
      })
  }
}

export const ACCESSORIES = Object.keys(ACCESSORY_ART) as readonly CharacterAccessory[]

// Why no crown: the crown marks the lead, so a derived look must never wear one.
const PLAIN_ACCESSORIES = ACCESSORIES.filter((one) => one !== 'crown')

// Why not `#` or `:`: hd reads those as outline and backed gap.
const SPARE_GLYPHS = '&$%*+=?~^@'

const headOf = (rows: readonly string[]): Head | undefined => {
  const top = rows.findIndex((row) => /[^.]/.test(row))
  const row = rows[top]
  if (row === undefined) {
    return undefined
  }
  const from = row.search(/[^.]/)
  const to = row.search(/[^.]\.*$/)
  return { up: Math.max(0, top - 1), top, from, to, centre: Math.round((from + to) / 2) }
}

const withAccessory = (
  costume: Costume,
  accessory: CharacterAccessory,
  color?: number
): Costume => {
  const head = headOf(costume.rows)
  const glyph = [...SPARE_GLYPHS].find((one) => !Object.hasOwn(costume.colors, one))
  if (head === undefined || glyph === undefined) {
    return costume
  }
  const art = ACCESSORY_ART[accessory]
  const rows = costume.rows.map((row) => [...row])
  for (const [x, y] of art.cells(head, costume.rows)) {
    const row = rows[y]
    if (row?.[x] === '.') {
      row[x] = glyph
    }
  }
  return {
    rows: rows.map((row) => row.join('')),
    legs: costume.legs,
    colors: { ...costume.colors, [glyph]: color ?? art.color }
  }
}

const variantCostumeOf = (costume: Costume, variant: CharacterVariant): Costume => {
  const colored =
    variant.colors === undefined
      ? costume
      : { ...costume, colors: { ...costume.colors, ...variant.colors } }
  return variant.accessory === undefined
    ? colored
    : withAccessory(colored, variant.accessory, variant.accessoryColor)
}

const keysOf = (name: LocalizedName): string[] =>
  (typeof name === 'string' ? [name] : Object.values(name)).map((one) => one.toLowerCase())

/** The character a member was named after; `Merlin 2`, once every name is taken, is Merlin too. */
export const characterOf = (
  scene: SceneDefinition,
  memberName: string | undefined
): SceneCharacter | undefined => {
  if (memberName === undefined) {
    return undefined
  }
  const shown = shortMemberNameOf(memberName).trim().toLowerCase()
  const find = (wanted: string) =>
    scene.characters?.find((one) => keysOf(one.name).includes(wanted))
  return find(shown) ?? find(shown.replace(/ \d+$/, ''))
}

// Why cached: hd caches a sprite per costume object, so a look must be the same object every tick.
const looks = new WeakMap<SceneDefinition, Map<string, Costume>>()

const lookOf = (scene: SceneDefinition, memberName: string): Costume => {
  const character = characterOf(scene, memberName)
  // Why the character's name: `Merlin 2` and `Merlín` wear Merlin's figure, not one of their own.
  const key = character === undefined ? lookKeyOf(memberName) : keysOf(character.name)[0] ?? ''
  const made = looks.get(scene) ?? new Map<string, Costume>()
  looks.set(scene, made)
  const kept = made.get(key)
  if (kept !== undefined) {
    return kept
  }
  const authored = character?.variant
  const variant = authored ?? derivedVariantOf(scene, key, PLAIN_ACCESSORIES)
  const look = variantCostumeOf(bodyOf(scene, key, authored), variant)
  made.set(key, look)
  return look
}

/** What `memberName` wears in `phase`: the same figure in all of them; nameless, the phase costume. */
export const characterCostumeOf = (
  scene: SceneDefinition,
  memberName: string | undefined,
  phase: ScenePhase
): Costume => {
  if (memberName === undefined) {
    return scene.costumes[phase]
  }
  return characterOf(scene, memberName)?.costumes?.[phase] ?? lookOf(scene, memberName)
}

const mostDrawnColorOf = (costume: Costume): number | undefined => {
  const counts = new Map<string, number>()
  for (const glyph of costume.rows.join('').replaceAll('.', '')) {
    counts.set(glyph, (counts.get(glyph) ?? 0) + 1)
  }
  const [glyph] = [...counts].reduce((best, one) => (one[1] > best[1] ? one : best), ['.', 0])
  return costume.colors[glyph]
}

/** The color that tells a character apart where no sprite is drawn. */
export const characterColorOf = (scene: SceneDefinition, memberName: string): number | undefined => {
  const variant = characterOf(scene, memberName)?.variant
  if (variant === undefined) {
    return mostDrawnColorOf(characterCostumeOf(scene, memberName, 'working'))
  }
  const accessory = variant.accessory === undefined ? undefined : ACCESSORY_ART[variant.accessory]
  return Object.values(variant.colors ?? {})[0] ?? variant.accessoryColor ?? accessory?.color
}
