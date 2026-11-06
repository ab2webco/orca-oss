import { z } from 'zod'
import { parseOrchestratorGameSceneFile } from './orchestrator-game-scene-file'
import { localizedSceneName } from './orchestrator-game-scene-values'
import { readRasterImageDimensions } from './raster-image-dimensions'

/** The optional art block of a scene: image files the native panel's styles draw, keyed by style. */

// Why caps on the files: they sit outside the 64 KB JSON, and any project or plugin can ship them.
export const ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES = 2 * 1024 * 1024
export const ORCHESTRATOR_GAME_SCENE_ART_MAX_STYLE_BYTES = 8 * 1024 * 1024
export const ORCHESTRATOR_GAME_SCENE_ART_MAX_STYLE_PIXELS = 16 * 1024 * 1024

const MAX_LAYERS = 8
const MAX_SHEETS = 16
const MAX_FRAME_PX = 512
const MAX_ROW = 63
const MAX_FRAMES = 32
const MAX_FPS = 30
const MIN_SIZE_PX = 16
const MAX_SIZE_PX = 160
const MAX_STRIDE_PX = 1024
const MEGABYTE = 1024 * 1024

const PATH_ERRORS = {
  'not-a-path': 'must be a path to an image next to the scene file',
  absolute: 'must be relative to the scene file, not absolute',
  outside: 'must stay inside the scene folder (no ..)'
}

const artPath = z.string({ error: PATH_ERRORS['not-a-path'] }).transform((value, ctx) => {
  const parsed = parseOrchestratorGameSceneFile(value)
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: PATH_ERRORS[parsed.error] })
    return z.NEVER
  }
  if (!/\.(png|webp)$/i.test(parsed.path)) {
    ctx.addIssue({ code: 'custom', message: 'must be a .png or .webp file' })
    return z.NEVER
  }
  return parsed.path
})

const wholeNumber = (min: number, max: number): z.ZodNumber => {
  const error = `must be a whole number from ${min} to ${max}`
  return z.number({ error }).int(error).min(min, error).max(max, error)
}

const animationSchema = z.object({
  /** The sheet row; its frames run left to right from the first column. */
  row: wholeNumber(0, MAX_ROW),
  frames: wholeNumber(1, MAX_FRAMES),
  /** Ignored by `walk`, which the engine steps by distance so feet stay planted. */
  fps: wholeNumber(1, MAX_FPS).default(8),
  /** Sheet pixels the ground moves in one `walk` cycle; without it, feet slide at other sizes. */
  stride: wholeNumber(1, MAX_STRIDE_PX).optional(),
  /** What the scene calls this action; the engine's own word when absent. */
  label: localizedSceneName.optional()
})

// Why strict, unlike the scene: a misspelt action would stand idle with no error. An older Orca
// that meets a newer action drops this block and draws Pixel, the format's floor.
const animationsSchema = z.strictObject({
  idle: animationSchema,
  work: animationSchema.optional(),
  walk: animationSchema.optional(),
  raise: animationSchema.optional(),
  give: animationSchema.optional(),
  wave: animationSchema.optional(),
  cheer: animationSchema.optional()
})

const roleSchema = z.object({
  /** One sheet per look, same layout in each; a member keeps its look by its character. */
  sheets: z.array(artPath).min(1).max(MAX_SHEETS),
  frame: z.object({
    width: wholeNumber(1, MAX_FRAME_PX),
    height: wholeNumber(1, MAX_FRAME_PX)
  }),
  /** Where the feet are in a frame, in sheet pixels; the bottom center when absent. */
  feet: z.object({ x: wholeNumber(0, MAX_FRAME_PX), y: wholeNumber(0, MAX_FRAME_PX) }).optional(),
  /** Drawn height at the front of the stage, in CSS pixels. */
  size: wholeNumber(MIN_SIZE_PX, MAX_SIZE_PX),
  animations: animationsSchema
})

const styleSchema = z.object({
  /** Back to front, each covering the stage from its bottom edge. */
  layers: z
    .array(z.object({ src: artPath, front: z.boolean().optional() }))
    .min(1)
    .max(MAX_LAYERS),
  roles: z.object({
    lead: roleSchema,
    member: roleSchema,
    /** Wears the member art when absent. */
    advisor: roleSchema.optional()
  }),
  props: z.object({ station: artPath.optional() }).optional()
})

// Why only these keys: Pixel is the game's own art, and Soft has no drawn result yet.
const nativeSchema = z
  .object({ figures: styleSchema.optional(), office: styleSchema.optional() })
  .refine((native) => native.figures !== undefined || native.office !== undefined, {
    error: 'must draw at least one of figures or office'
  })

export type OrchestratorGameSceneNative = z.infer<typeof nativeSchema>
export type OrchestratorGameSceneNativeStyle = z.infer<typeof styleSchema>

/** Mirrors the panel's styles; a scene has art for some of them at most. */
export type OrchestratorGameSceneStyle = 'figures' | 'soft' | 'office' | 'pixel'

// Why apart, like the roster and themes: a bad block only costs the art; the scene draws in Pixel.
export function orchestratorGameSceneNativeOf(raw: unknown): {
  native?: OrchestratorGameSceneNative
  issues: string[]
} {
  if (typeof raw !== 'object' || raw === null || !('native' in raw)) {
    return { issues: [] }
  }
  const parsed = nativeSchema.safeParse(raw.native)
  return parsed.success
    ? { native: parsed.data, issues: [] }
    : {
        issues: parsed.error.issues.map(
          (issue) => `${['native', ...issue.path].join('.')}: ${issue.message}`
        )
      }
}

type ArtPlace = { place: string; src: string }

const placesOfStyle = (name: string, style: OrchestratorGameSceneNativeStyle): ArtPlace[] => [
  ...style.layers.map((layer, at) => ({
    place: `native.${name}.layers.${at}.src`,
    src: layer.src
  })),
  ...Object.entries(style.roles).flatMap(([role, art]) =>
    (art?.sheets ?? []).map((src, at) => ({
      place: `native.${name}.roles.${role}.sheets.${at}`,
      src
    }))
  ),
  ...(style.props?.station === undefined
    ? []
    : [{ place: `native.${name}.props.station`, src: style.props.station }])
]

const stylesOf = (
  native: OrchestratorGameSceneNative
): [string, OrchestratorGameSceneNativeStyle][] =>
  Object.entries(native).filter(
    (entry): entry is [string, OrchestratorGameSceneNativeStyle] => entry[1] !== undefined
  )

/** Every image the block names, each once, relative to the scene file. */
export function orchestratorGameSceneArtFiles(native: OrchestratorGameSceneNative): string[] {
  const places = stylesOf(native).flatMap(([name, style]) => placesOfStyle(name, style))
  return [...new Set(places.map((one) => one.src))]
}

export type OrchestratorGameSceneArtRead = { bytes: Uint8Array } | { error: string }

type ArtFile = { size: number; width: number; height: number }

/** Why a reader may refuse a file by its size alone, without loading it. */
export const ORCHESTRATOR_GAME_SCENE_ART_TOO_LARGE = `larger than ${ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES / MEGABYTE} MB`

function fileOf(read: OrchestratorGameSceneArtRead): ArtFile | { error: string } {
  if ('error' in read) {
    return read
  }
  if (read.bytes.byteLength > ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES) {
    return { error: ORCHESTRATOR_GAME_SCENE_ART_TOO_LARGE }
  }
  const dimensions = readRasterImageDimensions(read.bytes)
  return dimensions
    ? { size: read.bytes.byteLength, ...dimensions }
    : { error: 'is not a PNG or WebP image' }
}

function frameIssues(
  name: string,
  style: OrchestratorGameSceneNativeStyle,
  files: ReadonlyMap<string, ArtFile | { error: string }>
): string[] {
  return Object.entries(style.roles).flatMap(([role, art]) =>
    art === undefined
      ? []
      : Object.entries(art.animations).flatMap(([action, animation]) =>
          animation === undefined
            ? []
            : art.sheets.flatMap((src) => {
                const file = files.get(src)
                const width = animation.frames * art.frame.width
                const height = (animation.row + 1) * art.frame.height
                return !file || 'error' in file || (file.width >= width && file.height >= height)
                  ? []
                  : [
                      `native.${name}.roles.${role}.animations.${action}: ${animation.frames} frames in row ${animation.row} need ${src} to be at least ${width}x${height}, it is ${file.width}x${file.height}`
                    ]
              })
        )
  )
}

function budgetIssues(
  name: string,
  style: OrchestratorGameSceneNativeStyle,
  files: ReadonlyMap<string, ArtFile | { error: string }>
): string[] {
  const read = [...new Set(placesOfStyle(name, style).map((one) => one.src))].flatMap((src) => {
    const file = files.get(src)
    return file && !('error' in file) ? [file] : []
  })
  const bytes = read.reduce((sum, file) => sum + file.size, 0)
  const pixels = read.reduce((sum, file) => sum + file.width * file.height, 0)
  return [
    ...(bytes > ORCHESTRATOR_GAME_SCENE_ART_MAX_STYLE_BYTES
      ? [
          `native.${name}: its files add up to ${(bytes / MEGABYTE).toFixed(1)} MB, more than the ${ORCHESTRATOR_GAME_SCENE_ART_MAX_STYLE_BYTES / MEGABYTE} MB a style may use`
        ]
      : []),
    ...(pixels > ORCHESTRATOR_GAME_SCENE_ART_MAX_STYLE_PIXELS
      ? [
          `native.${name}: decodes to ${(pixels / MEGABYTE).toFixed(1)} MP, more than the ${ORCHESTRATOR_GAME_SCENE_ART_MAX_STYLE_PIXELS / MEGABYTE} MP a style may use`
        ]
      : [])
  ]
}

/** Every reason the block's files would not draw; `read` decides where they live and contains them. */
export async function orchestratorGameSceneArtIssues(
  native: OrchestratorGameSceneNative,
  read: (src: string) => Promise<OrchestratorGameSceneArtRead>
): Promise<string[]> {
  const sources = orchestratorGameSceneArtFiles(native)
  const files = new Map(
    await Promise.all(sources.map(async (src) => [src, fileOf(await read(src))] as const))
  )
  return stylesOf(native).flatMap(([name, style]) => [
    ...placesOfStyle(name, style).flatMap(({ place, src }) => {
      const file = files.get(src)
      return file && 'error' in file ? [`${place}: ${file.error}`] : []
    }),
    ...frameIssues(name, style, files),
    ...budgetIssues(name, style, files)
  ])
}

/**
 * The style a scene really draws in: the one asked for when art exists for it, else Pixel, which
 * every scene has. Quest's art for Figures and Office ships with Orca, so its file needs no block.
 */
export function orchestratorGameSceneDrawnStyle(args: {
  style: OrchestratorGameSceneStyle
  sceneId: string
  /** The scene game state carries; absent when a file did not read or the scene is built in. */
  scene?: { native?: OrchestratorGameSceneNative }
  /** The art did not load here, such as a carried scene whose files stayed on the lead. */
  artFailed?: boolean
}): OrchestratorGameSceneStyle {
  const { style, sceneId, scene, artFailed } = args
  if ((style !== 'figures' && style !== 'office') || artFailed) {
    return 'pixel'
  }
  return scene?.native?.[style] || sceneId === 'quest' ? style : 'pixel'
}
