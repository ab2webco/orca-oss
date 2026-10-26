import { z } from 'zod'
import {
  orchestratorGameSceneCastOf,
  type OrchestratorGameSceneCast
} from './orchestrator-game-scene-cast'
import {
  color,
  displayText,
  glyph,
  hexColor,
  localizedSceneName,
  uncoloredGlyphOf
} from './orchestrator-game-scene-values'
import { parseMemberRoster, type GameMemberName } from './orchestrator-game-member-names'
import {
  orchestratorGameScene3dOf,
  type OrchestratorGameScene3d
} from './orchestrator-game-scene-3d'

/** Scenes a plugin contributes to the Agent Teams game: inert JSON the bundled mod draws. */

export const ORCHESTRATOR_GAME_SCENE_PHASES = [
  'working',
  'docs',
  'build',
  'verify',
  'pr',
  'handoff'
] as const

export const ORCHESTRATOR_GAME_SCENE_MAX_BYTES = 64 * 1024
// Why: the mod draws a costume as six rows plus a legs row inside an eight-pixel tile.
export const ORCHESTRATOR_GAME_COSTUME_ROWS = 6

// Why ASCII: the mod indexes rows by UTF-16 unit, so one glyph must be one unit.
const spriteRow = z.string().regex(/^[!-~]{10}$/, 'must be ten printable ASCII glyphs')
const lookSchema = z.object({
  skyTop: color,
  skyBottom: color,
  sun: color,
  isNight: z.boolean(),
  far: color,
  snow: color,
  near: color,
  ground: color,
  plant: color,
  plantKind: z.enum(['tree', 'cactus', 'none', 'antenna', 'crystal', 'flower']),
  cloud: color,
  scenery: z.enum(['peaks', 'skyline', 'crystals', 'meadow']).optional(),
  isSignal: z.boolean().optional()
})

const costumeSchema = z
  .object({
    rows: z.array(spriteRow).length(ORCHESTRATOR_GAME_COSTUME_ROWS),
    legs: z.tuple([spriteRow, spriteRow]),
    colors: z.record(glyph, color)
  })
  .superRefine((costume, ctx) => {
    const missing = uncoloredGlyphOf([...costume.rows, ...costume.legs], costume.colors)
    if (missing !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['colors'], message: `glyph "${missing}" has no color` })
    }
  })

const cardSchema = z.object({ icon: displayText(4), name: localizedSceneName, color: hexColor })

// Mirrors the mod's isRasterText: Latin, punctuation, box drawing and blocks, ★ and card suits.
const isPixelArtCode = (code: number): boolean =>
  (code >= 0x20 && code < 0x7f) ||
  (code >= 0xa0 && code < 0x300) ||
  (code >= 0x2010 && code <= 0x2027) ||
  (code >= 0x2500 && code <= 0x25ff) ||
  code === 0x2605 ||
  (code >= 0x2660 && code <= 0x2667)
// Why: the finale is painted into the pixel art, which refuses a frame with a wide character.
const pixelArtText = z
  .string()
  .min(1)
  .max(24)
  .refine(
    (value) => [...value].every((one) => isPixelArtCode(one.codePointAt(0) ?? 0)),
    'must be width-1 characters (Latin, punctuation, box drawing, ★ or card suits)'
  )
const finaleSchema = z.union([
  pixelArtText,
  z.object({
    en: pixelArtText,
    es: pixelArtText.optional()
  })
])

const byPhase = <T extends z.ZodType>(schema: T) =>
  z.object({
    working: schema,
    docs: schema,
    build: schema,
    verify: schema,
    pr: schema,
    handoff: schema
  })

// Why not strict: a scene written for a newer Orca keeps working on an older one.
const sceneFileSchema = z.object({
  looks: byPhase(lookSchema),
  costumes: byPhase(costumeSchema),
  cards: byPhase(cardSchema),
  teller: cardSchema,
  band: z.object({ gold: hexColor, ink: hexColor, panel: hexColor, parchment: hexColor }),
  foe: costumeSchema.optional(),
  finale: finaleSchema.optional(),
  hud: z
    .object({
      skyTop: color,
      skyBottom: color,
      frame: color,
      text: color,
      dim: color,
      star: color
    })
    .optional()
})

const THEMES_MAX = 8
const themesError = `must be a list of 1 to ${THEMES_MAX} themes`
const weightError = 'must be from 0 to 1'
const themeSchema = z.object({
  name: localizedSceneName,
  weight: z.number({ error: weightError }).min(0, weightError).max(1, weightError),
  look: lookSchema
    .pick({
      skyTop: true,
      skyBottom: true,
      sun: true,
      far: true,
      snow: true,
      near: true,
      ground: true,
      plant: true,
      cloud: true
    })
    .partial()
    .refine(
      (look) => Object.values(look).some((one) => one !== undefined),
      'must set at least one look color'
    )
})
const themesSchema = z
  .array(themeSchema, { error: themesError })
  .min(1, themesError)
  .max(THEMES_MAX, themesError)

export type OrchestratorGameSceneTheme = z.infer<typeof themeSchema>

export type OrchestratorGameSceneDefinition = z.infer<typeof sceneFileSchema> & {
  id: string
  cast?: OrchestratorGameSceneCast
  /** Names a lead's members take, in order. */
  roster?: GameMemberName[]
  /** Palette variants the band shows one a day, in turn with the plain looks. */
  themes?: OrchestratorGameSceneTheme[]
  /** What the WebGL panel draws; without it the scene is 2D only. */
  scene3d?: OrchestratorGameScene3d
}

type SceneParse =
  | { ok: true; definition: OrchestratorGameSceneDefinition; warnings: string[] }
  | { ok: false; error: string }

const rawCastOf = (raw: unknown): unknown =>
  typeof raw === 'object' && raw !== null && 'cast' in raw ? raw.cast : undefined

// Why apart, like the cast: a bad roster only costs the names, never the scene.
function rosterOf(raw: unknown): { roster?: GameMemberName[]; issues: string[] } {
  if (typeof raw !== 'object' || raw === null || !('roster' in raw)) {
    return { issues: [] }
  }
  const { roster, problems } = parseMemberRoster(raw.roster)
  return {
    roster,
    issues: problems.map(({ path, message }) => `roster${path ? `.${path}` : ''}: ${message}`)
  }
}

// Why apart, like the roster: bad themes only cost the variants, never the scene.
function themesOf(raw: unknown): { themes?: OrchestratorGameSceneTheme[]; issues: string[] } {
  if (typeof raw !== 'object' || raw === null || !('themes' in raw)) {
    return { issues: [] }
  }
  const parsed = themesSchema.safeParse(raw.themes)
  return parsed.success
    ? { themes: parsed.data, issues: [] }
    : {
        issues: parsed.error.issues.map(
          (issue) => `${['themes', ...issue.path].join('.')}: ${issue.message}`
        )
      }
}

export type OrchestratorGameSceneExtension = {
  id: string
  pluginId: string
  definition: OrchestratorGameSceneDefinition
}

export type OrchestratorGameSceneSource = { pluginId: string; id: string } & (
  | { text: string }
  | { error: string }
)

/** Every reason Orca would refuse `text` as a scene, each as `path: message`; empty when valid. */
export function orchestratorGameSceneIssues(text: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return ['not valid JSON']
  }
  const parsed = sceneFileSchema.safeParse(raw)
  return [
    ...(parsed.success
      ? []
      : parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
        )),
    ...orchestratorGameSceneCastOf(rawCastOf(raw)).issues,
    ...rosterOf(raw).issues,
    ...themesOf(raw).issues,
    ...orchestratorGameScene3dOf(raw).issues
  ]
}

export function parseOrchestratorGameScene(text: string, id: string): SceneParse {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  const parsed = sceneFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: `${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid scene'}`
    }
  }
  // Why apart: a bad pet or advisor is left out with a warning; the scene and its hero still draw.
  const { cast, issues } = orchestratorGameSceneCastOf(rawCastOf(raw))
  const { roster, issues: rosterIssues } = rosterOf(raw)
  const { themes, issues: themeIssues } = themesOf(raw)
  const { scene3d, issues: scene3dIssues } = orchestratorGameScene3dOf(raw)
  return {
    ok: true,
    definition: {
      ...parsed.data,
      ...(cast === undefined ? {} : { cast }),
      ...(roster === undefined ? {} : { roster }),
      ...(themes === undefined ? {} : { themes }),
      ...(scene3d === undefined ? {} : { scene3d }),
      id
    },
    warnings: [...issues, ...rosterIssues, ...themeIssues, ...scene3dIssues]
  }
}

// Why `<pluginId>/<id>`: two plugins, or a plugin and the built-in quest, can never share an id.
export const orchestratorGameSceneId = (pluginId: string, id: string): string => `${pluginId}/${id}`

export function orchestratorGameScenesOf(sources: readonly OrchestratorGameSceneSource[]): {
  scenes: OrchestratorGameSceneExtension[]
  warnings: string[]
} {
  const scenes: OrchestratorGameSceneExtension[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const id = orchestratorGameSceneId(source.pluginId, source.id)
    const parsed: SceneParse = seen.has(id)
      ? { ok: false, error: 'duplicate scene id' }
      : 'error' in source
        ? { ok: false, error: source.error }
        : parseOrchestratorGameScene(source.text, id)
    if (!parsed.ok) {
      warnings.push(`game scene ${id} dropped: ${parsed.error}`)
      continue
    }
    seen.add(id)
    warnings.push(...parsed.warnings.map((one) => `game scene ${id}: ${one}; drawn without it`))
    scenes.push({ id, pluginId: source.pluginId, definition: parsed.definition })
  }
  return { scenes, warnings }
}
