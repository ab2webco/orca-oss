// What orca-game-scene-captures.mjs shoots: its options and the scene captures per phase.
import { join, resolve } from 'node:path'

export const SCENE_PHASES = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

const COLUMNS = [130, 60]
const TIMES = [
  ['dawn', 6],
  ['day', 12],
  ['dusk', 18],
  ['night', 23]
]

/** `--out`, `--scene-file`, `--phases <all|a,b>`, `--gesture` and `--columns <a,b>`; phases stay undefined when not passed. */
export const captureOptionsOf = (argv, root) => {
  const argOf = (name) => {
    const at = argv.indexOf(name)
    return at === -1 ? undefined : argv[at + 1]
  }
  const asked = argOf('--phases')
  const phases = asked === 'all' ? SCENE_PHASES : asked?.split(',').map((one) => one.trim())
  const unknown = phases?.find((one) => !SCENE_PHASES.includes(one))
  if (unknown !== undefined) {
    throw new Error(`Unknown phase "${unknown}"; use all or some of ${SCENE_PHASES.join(', ')}`)
  }
  const widths = argOf('--columns')
    ?.split(',')
    .map((one) => one.trim())
  const badWidth = widths?.find((one) => !/^[1-9]\d*$/.test(one))
  if (badWidth !== undefined) {
    throw new Error(`Unknown width "${badWidth}"; use whole columns such as 45,80,160`)
  }
  return {
    out: resolve(argOf('--out') ?? join(root, 'out/orca-game-captures')),
    sceneFile: argOf('--scene-file'),
    phases,
    gesture: argOf('--gesture') ?? 'approved',
    columns: widths?.map(Number) ?? COLUMNS
  }
}

/** A scene file is looked at in every phase by default; a built-in only in build, the costliest. */
export const scenePhasesOf = (phases, isFile) => phases ?? (isFile ? SCENE_PHASES : ['build'])

export const sceneShotsOf = (id, phases, widths = COLUMNS) =>
  phases.flatMap((phase) =>
    widths.flatMap((columns) => [
      { name: `${id}-${phase}-classic-${columns}`, phase, render: 'classic', columns },
      ...TIMES.map(([time, hour]) => ({
        name: `${id}-${phase}-hd-${time}-${columns}`,
        phase,
        render: 'hd',
        columns,
        hour
      }))
    ])
  )

/** Each roster name of a scene as its Panel tile, so its characters are compared side by side. */
export const rosterShotsOf = (id, phases, names) =>
  phases.flatMap((phase) =>
    names.map((member, i) => ({ name: `roster-${id}-${phase}-${i + 1}`, phase, member }))
  )

// 1440, 768, 390 and 320 px at 9 px a cell; the game's look has a day and a night, no app theme.
const ARCADE_COLUMNS = [160, 85, 43, 35]

/** A run in play per scene, time and width, then the captioned screens at the narrow widths. */
export const arcadeShotsOf = (ids) => [
  ...ids.flatMap((scene) =>
    [TIMES[1], TIMES[3]].flatMap(([time, hour]) =>
      ARCADE_COLUMNS.map((columns) => ({
        name: `arcade-${scene}-${time}-${columns}`,
        scene,
        hour,
        columns
      }))
    )
  ),
  ...ids.flatMap((scene) => [
    { name: `arcade-${scene}-over-43`, scene, hour: 12, columns: 43, screen: 'over' },
    { name: `arcade-${scene}-paused-35`, scene, hour: 23, columns: 35, screen: 'paused' }
  ])
]
