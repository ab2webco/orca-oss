import {
  ADVISOR_GESTURES,
  CAST_MAX_FRAMES,
  CAST_MAX_ROWS,
  CAST_MAX_WIDTH,
  type AdvisorGesture,
  type CastFrame,
  type SceneAdvisor,
  type SceneCast,
  type ScenePet
} from './scene-definition'
import { glyphColorsOf, isShape, nameOf } from './scene-values'

// Re-reads a scene's cast; a member the game cannot draw is left out, the scene still draws.

const CAST_ROW = new RegExp(`^[!-~]{1,${CAST_MAX_WIDTH}}$`)

const frameOf = (value: unknown): CastFrame | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > CAST_MAX_ROWS) {
    return undefined
  }
  const rows = value.filter((row): row is string => typeof row === 'string' && CAST_ROW.test(row))
  return rows.length === value.length && rows.every((row) => row.length === rows[0]?.length)
    ? rows
    : undefined
}

const framesOf = (value: unknown): CastFrame[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > CAST_MAX_FRAMES) {
    return undefined
  }
  const frames = value.map(frameOf)
  return frames.every((one) => one !== undefined) ? frames : undefined
}

const sizeOf = (frame: CastFrame): string => `${frame[0]?.length ?? 0}x${frame.length}`

// Why one size and every glyph colored: the game places a member by its first frame.
const isDrawable = (
  frames: readonly CastFrame[],
  colors: Readonly<Record<string, number>>
): boolean => {
  const size = sizeOf(frames[0] ?? [])
  const glyphs = frames.flat().join('').replaceAll('.', '')
  return (
    frames.every((frame) => sizeOf(frame) === size) &&
    [...glyphs].every((one) => Object.hasOwn(colors, one))
  )
}

// Absent stays absent; present but invalid is undefined, so the caller leaves it out.
const optionalNameOf = (value: unknown) =>
  value === undefined ? null : (nameOf(value) ?? undefined)

const petOf = (value: unknown): ScenePet | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const frames = framesOf(value.frames)
  const happy = frameOf(value.happy)
  const colors = glyphColorsOf(value.colors)
  const name = optionalNameOf(value.name)
  if (
    !frames ||
    !happy ||
    !colors ||
    name === undefined ||
    !isDrawable([...frames, happy], colors)
  ) {
    return undefined
  }
  return { ...(name === null ? {} : { name }), frames, happy, colors }
}

// Why ignore an unknown gesture: one a newer game acts out must not take the advisor away.
const gesturesOf = (
  value: unknown
): Partial<Record<AdvisorGesture, CastFrame>> | null | undefined => {
  if (value === undefined) {
    return null
  }
  if (!isShape(value)) {
    return undefined
  }
  const pairs = ADVISOR_GESTURES.filter((one) => value[one] !== undefined).map(
    (one) => [one, frameOf(value[one])] as const
  )
  return pairs.every(([, frame]) => frame !== undefined)
    ? (Object.fromEntries(pairs) as Partial<Record<AdvisorGesture, CastFrame>>)
    : undefined
}

const advisorOf = (value: unknown): SceneAdvisor | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const frames = framesOf(value.frames)
  const gestures = gesturesOf(value.gestures)
  const colors = glyphColorsOf(value.colors)
  const name = optionalNameOf(value.name)
  if (!frames || gestures === undefined || !colors || name === undefined) {
    return undefined
  }
  if (!isDrawable([...frames, ...Object.values(gestures ?? {})], colors)) {
    return undefined
  }
  return {
    ...(name === null ? {} : { name }),
    frames,
    ...(gestures === null ? {} : { gestures }),
    colors
  }
}

export const castOf = (value: unknown): SceneCast | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const pet = petOf(value.pet)
  const advisor = advisorOf(value.advisor)
  return pet === undefined && advisor === undefined
    ? undefined
    : { ...(pet === undefined ? {} : { pet }), ...(advisor === undefined ? {} : { advisor }) }
}
