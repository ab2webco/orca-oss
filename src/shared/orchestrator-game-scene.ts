import { z } from 'zod'
import { isSafeDisplayCharacter } from './skill-display-text'

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

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color')
// Why both: JSON has no hex literals, so authors write '#rrggbb'; the mod always receives a number.
const color = z.union(
  [
    z.number().int().min(0).max(0xffffff),
    hexColor.transform((value) => Number.parseInt(value.slice(1), 16))
  ],
  { error: 'must be a #rrggbb color or an integer from 0 to 16777215' }
)
// Why: names reach the terminal verbatim, so control and bidi characters could rewrite the screen.
const displayText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => [...value].every(isSafeDisplayCharacter),
      'must not contain control characters'
    )
// Why ASCII: the mod indexes rows by UTF-16 unit, so one glyph must be one unit.
const spriteRow = z.string().regex(/^[!-~]{10}$/, 'must be ten printable ASCII glyphs')
const glyph = z
  .string()
  .regex(/^[!-~]$/, 'must be one printable ASCII glyph')
  .refine((key) => key !== '.', {
    message: "'.' is reserved for transparent"
  })

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
    for (const row of [...costume.rows, ...costume.legs]) {
      for (const one of row) {
        if (one !== '.' && !Object.hasOwn(costume.colors, one)) {
          ctx.addIssue({ code: 'custom', path: ['colors'], message: `glyph "${one}" has no color` })
          return
        }
      }
    }
  })

const sceneName = displayText(32)
// Why: the mod shows the name in Orca's UI language; unknown languages are stripped, not rejected.
const localizedSceneName = z.union([
  sceneName,
  z.object({
    en: sceneName,
    es: sceneName.optional()
  })
])

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

export type OrchestratorGameSceneDefinition = z.infer<typeof sceneFileSchema> & { id: string }

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
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
}

export function parseOrchestratorGameScene(
  text: string,
  id: string
): { ok: true; definition: OrchestratorGameSceneDefinition } | { ok: false; error: string } {
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
  return { ok: true, definition: { ...parsed.data, id } }
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
    const parsed:
      | { ok: true; definition: OrchestratorGameSceneDefinition }
      | { ok: false; error: string } = seen.has(id)
      ? { ok: false, error: 'duplicate scene id' }
      : 'error' in source
        ? { ok: false, error: source.error }
        : parseOrchestratorGameScene(source.text, id)
    if (!parsed.ok) {
      warnings.push(`game scene ${id} dropped: ${parsed.error}`)
      continue
    }
    seen.add(id)
    scenes.push({ id, pluginId: source.pluginId, definition: parsed.definition })
  }
  return { scenes, warnings }
}
