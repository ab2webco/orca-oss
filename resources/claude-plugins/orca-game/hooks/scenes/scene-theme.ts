import { mix } from '../pixel-canvas'
import type { Look, LookColor, SceneDefinition, ScenePhase, SceneTheme } from './scene-definition'

// A scene's palette themes take turns by calendar day with its plain looks: data only, no setting.

// Why offset by the id: two themed scenes should not change on the same days.
const offsetOf = (id: string): number =>
  [...id].reduce((sum, one) => (Math.imul(sum, 31) + (one.codePointAt(0) ?? 0)) | 0, 7) >>> 0

/** The theme a scene wears on `day` (days since 1970), or none on its plain days. */
export const themeOfDay = (scene: SceneDefinition, day: number): SceneTheme | undefined => {
  const themes = scene.themes ?? []
  const slot = (day + offsetOf(scene.id)) % (themes.length + 1)
  return slot === 0 ? undefined : themes[slot - 1]
}

const themedLookOf = (look: Look, theme: SceneTheme): Look => ({
  ...look,
  ...Object.fromEntries(
    (Object.entries(theme.look) as [LookColor, number | undefined][]).flatMap(([key, color]) =>
      color === undefined ? [] : [[key, mix(look[key], color, theme.weight)]]
    )
  )
})

const themed = new WeakMap<SceneDefinition, { day: number; scene: SceneDefinition }>()

/** The scene in its theme of `day`; the same scene when there is none or the day is unknown. */
export const themedSceneOf = (scene: SceneDefinition, day: number | undefined): SceneDefinition => {
  const theme = day === undefined ? undefined : themeOfDay(scene, day)
  if (day === undefined || theme === undefined) {
    return scene
  }
  const kept = themed.get(scene)
  if (kept?.day === day) {
    return kept.scene
  }
  const looks = Object.fromEntries(
    Object.entries(scene.looks).map(([phase, look]) => [phase, themedLookOf(look, theme)])
  ) as Record<ScenePhase, Look>
  const next = { ...scene, looks }
  themed.set(scene, { day, scene: next })
  return next
}
